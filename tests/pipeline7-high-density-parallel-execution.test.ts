import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type {
  HighDensityNodeSolveResult,
  HighDensityNodeSolveTask,
  HighDensitySolverExecutionContext,
  HighDensitySolverExecutor,
  HighDensitySolverExecutorSession,
} from "lib/solvers/HighDensitySolver/high-density-parallel-types"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.15,
  minViaDiameter: 0.3,
  obstacles: [],
  connections: [],
  bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
}

const createNode = (nodeIndex: number): NodeWithPortPoints => ({
  capacityMeshNodeId: `cmn_${nodeIndex}`,
  center: { x: nodeIndex, y: 0 },
  width: 1,
  height: 1,
  portPoints: [
    {
      connectionName: `connection_${nodeIndex}`,
      x: nodeIndex - 0.25,
      y: 0,
      z: 0,
    },
    {
      connectionName: `connection_${nodeIndex}`,
      x: nodeIndex + 0.25,
      y: 0,
      z: 0,
    },
  ],
})

const createResult = (
  task: HighDensityNodeSolveTask,
): HighDensityNodeSolveResult => {
  const [start, end] = task.nodeWithPortPoints.portPoints
  const route: HighDensityIntraNodeRoute = {
    connectionName: start!.connectionName,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: start!.x, y: start!.y, z: start!.z },
      { x: end!.x, y: end!.y, z: end!.z },
    ],
    vias: [],
  }
  return {
    nodeIndex: task.nodeIndex,
    status: "solved",
    routes: [route],
    solverType: "fake-worker-solver",
    iterations: 1,
    routeCount: 1,
    growthAttempts: 0,
    cacheHits: 0,
    cacheMisses: 0,
  }
}

test("Pipeline7 bounds parallel high-density work and preserves sequential result order", async () => {
  const nodes = [createNode(0), createNode(1), createNode(2)]
  const startedNodeIds: string[] = []
  const pendingByNodeId = new Map<
    string,
    {
      task: HighDensityNodeSolveTask
      resolve: (result: HighDensityNodeSolveResult) => void
    }
  >()
  let activeTaskCount = 0
  let maximumActiveTaskCount = 0
  let configuredParallelism = 0
  let sessionDisposed = false
  let markInitialTasksStarted!: () => void
  const initialTasksStarted = new Promise<void>((resolve) => {
    markInitialTasksStarted = resolve
  })
  let markThirdTaskStarted!: () => void
  const thirdTaskStarted = new Promise<void>((resolve) => {
    markThirdTaskStarted = resolve
  })

  const session: HighDensitySolverExecutorSession = {
    execute(task) {
      structuredClone(task)
      const nodeId = task.nodeWithPortPoints.capacityMeshNodeId
      startedNodeIds.push(nodeId)
      activeTaskCount += 1
      maximumActiveTaskCount = Math.max(maximumActiveTaskCount, activeTaskCount)
      if (startedNodeIds.length === 2) markInitialTasksStarted()
      if (startedNodeIds.length === 3) markThirdTaskStarted()
      return new Promise((resolve) => {
        pendingByNodeId.set(nodeId, {
          task,
          resolve: (result) => {
            activeTaskCount -= 1
            resolve(result)
          },
        })
      })
    },
    dispose() {
      sessionDisposed = true
    },
  }
  const executor: HighDensitySolverExecutor = {
    createSession(
      context: HighDensitySolverExecutionContext,
      options: { parallelism: number },
    ) {
      structuredClone(context)
      configuredParallelism = options.parallelism
      return session
    },
  }

  const pipeline = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    highDensitySolverParallelism: 2,
    highDensitySolverExecutor: executor,
  })
  const highDensityStep = pipeline.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )!
  pipeline.pipelineDef = [highDensityStep] as typeof pipeline.pipelineDef
  pipeline.uniformPortDistributionSolver = {
    getOutput: () => nodes,
  } as any
  pipeline.portPointPathingSolver = {
    getOutput: () => ({
      nodesWithPortPoints: nodes,
      inputNodeWithPortPoints: [],
    }),
  } as any

  const solvePromise = pipeline.solveAsync()
  await initialTasksStarted
  expect(startedNodeIds).toEqual(["cmn_2", "cmn_1"])
  expect(configuredParallelism).toBe(2)
  const iterationsWhileWaiting = pipeline.iterations
  for (let repeatedStep = 0; repeatedStep < 1_000; repeatedStep++) {
    pipeline.step()
  }
  expect(pipeline.iterations).toBe(iterationsWhileWaiting)

  const nodeOne = pendingByNodeId.get("cmn_1")!
  nodeOne.resolve(createResult(nodeOne.task))
  await thirdTaskStarted
  expect(startedNodeIds).toEqual(["cmn_2", "cmn_1", "cmn_0"])

  const nodeZero = pendingByNodeId.get("cmn_0")!
  nodeZero.resolve(createResult(nodeZero.task))
  const nodeTwo = pendingByNodeId.get("cmn_2")!
  nodeTwo.resolve(createResult(nodeTwo.task))
  await solvePromise

  expect(maximumActiveTaskCount).toBe(2)
  expect(sessionDisposed).toBe(true)
  expect(pipeline.solved).toBe(true)
  expect(pipeline.failed).toBe(false)
  expect(pipeline.highDensityRouteSolver?.pendingEffects).toEqual([])
  expect(
    pipeline.highDensityRouteSolver?.routes.map(
      (route) => route.connectionName,
    ),
  ).toEqual(["connection_2", "connection_1", "connection_0"])
})
