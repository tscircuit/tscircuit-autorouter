import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver as OriginalSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type { HighDensityRoute } from "high-density-repair01/lib/types/high-density-types"
import { HighDensityForceImproveSolver as WorkerSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/force-improvement-fork/HighDensityForceImproveSolver"

type Params = ConstructorParameters<typeof OriginalSolver>[0]
type Solver = OriginalSolver | WorkerSolver

function createParams(): Params {
  const nodeWithPortPoints = [0, 1].map((index) => ({
    capacityMeshNodeId: `force-node-${index}`, center: { x: index * 10, y: 0 },
    width: 4, height: 4, availableZ: [0, 1], portPoints: [],
  }))
  const hdRoutes = nodeWithPortPoints.map((node): HighDensityRoute => ({
    regionId: node.capacityMeshNodeId, connectionName: node.capacityMeshNodeId,
    traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [-1, 0, 1].map((x) => ({ x: node.center.x + x, y: 0, z: 0 })),
  }))
  return { nodeWithPortPoints, hdRoutes, totalStepsPerNode: 0 }
}

function observableState(solver: Solver): unknown {
  return {
    solved: solver.solved, failed: solver.failed, error: solver.error,
    iterations: solver.iterations, progress: solver.progress, maxIterations: solver.MAX_ITERATIONS,
    stats: solver.stats, samples: solver.sampleEntries, activeSampleIndex: solver.activeSampleIndex,
    improvedRoutes: solver.improvedRoutesByIndex, routes: solver.getOutput(),
    totalStepsPerNode: solver.totalStepsPerNode, nodeAssignmentMargin: solver.nodeAssignmentMargin,
  }
}

function captureStepError(solver: Solver): Error {
  try {
    solver.step()
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw new Error("Force solver threw a non-Error value")
    return error
  }
  throw new Error("Malformed force route did not throw")
}

test("diagnostic-free force improvement preserves empty work, iteration exhaustion, and original exceptions", (): void => {
  for (const unassigned of [false, true]) {
    const params = createParams()
    if (unassigned) params.nodeWithPortPoints = []
    else params.hdRoutes = []
    const original = new OriginalSolver(structuredClone(params))
    const worker = new WorkerSolver({ ...structuredClone(params), captureDiagnostics: false })
    original.solve()
    worker.solve()
    expect(observableState(worker)).toEqual(observableState(original))
    expect(worker.solved).toBe(true)
    expect(worker.iterations).toBe(1)
    expect(worker.stats.sampleCount).toBe(0)
    expect(worker.latestVisualization).toEqual({})
    if (unassigned) expect(worker.getOutput()[0]).toBe(worker.originalHdRoutes[0])
  }
  const exhaustedOriginal = new OriginalSolver(createParams())
  const exhaustedWorker = new WorkerSolver({ ...createParams(), captureDiagnostics: false })
  for (const solver of [exhaustedOriginal, exhaustedWorker]) {
    solver.MAX_ITERATIONS = 0
    solver.step()
  }
  expect(observableState(exhaustedWorker)).toEqual(observableState(exhaustedOriginal))
  expect(exhaustedWorker.failed).toBe(true)
  expect(exhaustedWorker.solved).toBe(false)
  expect(exhaustedWorker.iterations).toBe(1)
  expect(exhaustedWorker.activeSampleIndex).toBe(1)
  expect(exhaustedWorker.stats.improvedRouteCount).toBe(1)
  expect(exhaustedWorker.error).toContain("MAX_ITERATIONS=0")
  expect(exhaustedWorker.latestVisualization).toEqual({})
  exhaustedWorker.step()
  expect(exhaustedWorker.iterations).toBe(1)
  const malformed = createParams()
  malformed.hdRoutes[0]!.route = null as unknown as HighDensityRoute["route"]
  const original = new OriginalSolver(structuredClone(malformed))
  const worker = new WorkerSolver({ ...structuredClone(malformed), captureDiagnostics: false })
  const originalError = captureStepError(original)
  const workerError = captureStepError(worker)
  expect(workerError.name).toBe(originalError.name)
  expect(workerError.message).toBe(originalError.message)
  expect(workerError).toBeInstanceOf(TypeError)
  expect(observableState(worker)).toEqual(observableState(original))
  expect(worker.failed).toBe(true)
  expect(worker.iterations).toBe(1)
  expect(worker.activeSampleIndex).toBe(0)
  expect(worker.improvedRoutesByIndex.size).toBe(0)
  expect(worker.latestVisualization).toEqual({})
})
