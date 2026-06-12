import { parentPort } from "node:worker_threads"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure.ts"
import { NodeWithPortPoints } from "lib/types/high-density-types.ts"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"

type WorkerRequest = {
  taskId: number
  problemId: string
  problem: unknown
}

type WorkerResponse =
  | {
      type: "result"
      taskId: number
      value: number
      avgViaPerUnitLength: number | null
      solved: boolean
      solveDurationMs: number
    }
  | {
      type: "error"
      taskId: number
      error: string
    }

const unwrapProblem = (problem: unknown) => {
  // The dataset currently wraps the benchmark payload as { id, data }.
  if (typeof problem === "object" && problem !== null && "data" in problem) {
    return (problem as { data: unknown }).data
  }

  return problem
}

const getRouteLength = (route: Array<{ x: number; y: number }>) => {
  let totalLength = 0

  for (let index = 1; index < route.length; index += 1) {
    const previousPoint = route[index - 1]
    const currentPoint = route[index]
    if (!previousPoint || !currentPoint) continue

    totalLength += Math.hypot(
      currentPoint.x - previousPoint.x,
      currentPoint.y - previousPoint.y,
    )
  }

  return totalLength
}

const getAverageViaPerUnitLength = (solver: HighDensitySolver) => {
  if (!solver.solved || solver.routes.length === 0) {
    return null
  }

  let totalViaCount = 0
  let totalRouteLength = 0

  for (const route of solver.routes) {
    totalViaCount += route.vias.length
    totalRouteLength += getRouteLength(route.route)
  }

  if (totalRouteLength <= 0) {
    return null
  }

  return totalViaCount / totalRouteLength
}

const computeProblemScore = (problem: unknown) => {
  // The worker keeps the benchmark math off the main thread.
  // The worker owns both the predictor and the real solve for one problem.
  const nodeWithPortPoints = unwrapProblem(problem) as NodeWithPortPoints
  const stats = getIntraNodeCrossingsUsingCircle(nodeWithPortPoints)

  // Normalize optional fields so the scoring function always sees the same shape.
  // Keep the payload normalized to the same shape used by the old benchmark path.
  const predictedPf = calculateNodeProbabilityOfFailure(
    {
      ...nodeWithPortPoints,
      layer: "",
      availableZ: nodeWithPortPoints.availableZ ?? [],
    },
    stats.numSameLayerCrossings,
    stats.numEntryExitLayerChanges,
    stats.numTransitionPairCrossings,
  )

  // The benchmark target must come from a real solve, not from cached result files.
  const solver = new HighDensitySolver({
    nodePortPoints: [nodeWithPortPoints],
  })
  const solveStart = performance.now()
  solver.solve()
  const solveDurationMs = performance.now() - solveStart

  // The target is binary: solved means 0 failure, unsolved means 1 failure.
  const actualFailure = solver.solved ? 0 : 1
  return {
    value: (predictedPf - actualFailure) ** 2,
    avgViaPerUnitLength: getAverageViaPerUnitLength(solver),
    solved: solver.solved,
    solveDurationMs,
  }
}

if (!parentPort) {
  throw new Error("Benchmark worker must run inside a worker thread")
}

const workerParentPort = parentPort

workerParentPort.on("message", (message: WorkerRequest) => {
  // A worker can process many tasks over its lifetime, one message at a time.
  // Each message is independent, so a failed problem should not poison the worker process.
  try {
    const result = computeProblemScore(message.problem)
    workerParentPort.postMessage({
      type: "result",
      taskId: message.taskId,
      value: result.value,
      avgViaPerUnitLength: result.avgViaPerUnitLength,
      solved: result.solved,
      solveDurationMs: result.solveDurationMs,
    } satisfies WorkerResponse)
  } catch (error) {
    // Report errors back to the parent so it can decide whether to continue or abort.
    const messageText = error instanceof Error ? error.message : String(error)
    workerParentPort.postMessage({
      type: "error",
      taskId: message.taskId,
      error: messageText,
    } satisfies WorkerResponse)
  }
})
