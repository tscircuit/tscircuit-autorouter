import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import type { SimpleRouteJson } from "lib/types"
import scenario from "./preexisting-connected-traces/srj/preexisting-connected-traces06.srj.json" with {
  type: "json",
}

test("Pipeline9 owns copied stages with minimal preloaded-trace changes", () => {
  const srj = structuredClone(scenario) as SimpleRouteJson
  srj.minBoardEdgeClearance = 0.23
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    targetMinCapacity: 0.75,
    maxNodeDimension: 3,
    effort: 0.1,
  })
  const traceFreeSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    { ...structuredClone(srj), traces: undefined },
    {
      targetMinCapacity: 0.75,
      maxNodeDimension: 3,
      effort: 0.1,
    },
  )
  const pipeline7 = new AutoroutingPipelineSolver7_MultiGraph(srj, {
    effort: 0.1,
  })

  expect(solver).not.toBeInstanceOf(AutoroutingPipelineSolver7_MultiGraph)
  expect(
    solver.pipelineDef.map(({ solverName, solverClass }) => ({
      solverName,
      solverClass,
    })),
  ).toEqual(
    traceFreeSolver.pipelineDef.map(({ solverName, solverClass }) => ({
      solverName,
      solverClass,
    })),
  )
  solver.solveUntilPhase("portPointPathingSolver")
  traceFreeSolver.solveUntilPhase("portPointPathingSolver")

  expect(
    solver.preprocessSimpleRouteJsonSolver
      ?.getOutputSimpleRouteJson()
      .obstacles.some((obstacle) =>
        obstacle.obstacleId?.startsWith("trace_obstacle_"),
      ),
  ).toBe(false)
  expect(
    solver.preprocessSimpleRouteJsonSolver?.getOutputSimpleRouteJson().traces,
  ).toEqual(srj.traces)
  const portPointPathingStep = solver.pipelineDef.find(
    (step) => step.solverName === "portPointPathingSolver",
  )
  const [portPointPathingParams] =
    portPointPathingStep!.getConstructorParams(solver)
  expect(
    (
      portPointPathingParams as {
        flags: {
          USE_PARTIAL_RIP_ROUTING_WITH_PRELOADED_TRACES?: boolean
        }
      }
    ).flags.USE_PARTIAL_RIP_ROUTING_WITH_PRELOADED_TRACES,
  ).toBeTrue()
  expect(solver.preloadedTraceGraphSolver?.stats).toMatchObject({
    preloadedTraceCount: 1,
    topologyChanged: false,
  })
  expect(traceFreeSolver.preloadedTraceGraphSolver?.stats).toMatchObject({
    preloadedTraceCount: 0,
    topologyChanged: false,
  })
  expect(
    solver.capacityNodes?.map(
      ({ capacityMeshNodeId, center, width, height, layer, availableZ }) => ({
        capacityMeshNodeId,
        center,
        width,
        height,
        layer,
        availableZ,
      }),
    ),
  ).toEqual(
    traceFreeSolver.capacityNodes?.map(
      ({ capacityMeshNodeId, center, width, height, layer, availableZ }) => ({
        capacityMeshNodeId,
        center,
        width,
        height,
        layer,
        availableZ,
      }),
    ),
  )

  const pipeline7Stages = new Map<string, unknown>(
    pipeline7.pipelineDef.map((step) => [step.solverName, step.solverClass]),
  )
  const pipeline7SharedStageCount = pipeline7.pipelineDef.filter(
    (step) => step.solverName !== "exactGeometryDrcForceImproveSolver",
  ).length
  expect(solver.pipelineDef).toHaveLength(pipeline7SharedStageCount + 4)
  for (const stageName of [
    "highDensityForceImproveSolver",
    "highDensityRepairSolver",
    "highDensityStitchSolver",
    "globalDrcForceImproveSolver",
    "powerTraceExpansionSolver",
  ]) {
    expect(
      solver.pipelineDef.find((step) => step.solverName === stageName)
        ?.solverClass as unknown,
    ).toBe(pipeline7Stages.get(stageName))
  }
  expect(
    solver.pipelineDef.find(
      (step) => step.solverName === "highDensityRouteSolver",
    )?.solverClass,
  ).toBe(Pipeline9HighDensitySolver)
  const pipeline9StageNames = solver.pipelineDef.map((step) => step.solverName)
  expect(
    solver.pipelineDef.find((step) => step.solverName === "repair04Solver")
      ?.solverClass,
  ).toBe(Pipeline9Repair04Solver)
  expect(pipeline9StageNames.indexOf("repair04Solver")).toBe(
    pipeline9StageNames.indexOf("globalDrcForceImproveSolver") + 1,
  )
  expect(pipeline9StageNames.indexOf("repair04Solver")).toBe(
    pipeline9StageNames.indexOf("pipeline9JointDrcRepairSolver") - 1,
  )
  const mutatedPreloadSimplificationStep = solver.pipelineDef.find(
    (step) => step.solverName === "mutatedPreloadedTraceSimplificationSolver",
  )
  expect(mutatedPreloadSimplificationStep?.solverClass).toBe(
    TraceSimplificationSolver,
  )
  expect(
    pipeline9StageNames.indexOf("mutatedPreloadedTraceSimplificationSolver"),
  ).toBe(pipeline9StageNames.indexOf("traceSimplificationSolver") + 1)
  expect(
    pipeline9StageNames.indexOf("mutatedPreloadedTraceSimplificationSolver"),
  ).toBe(pipeline9StageNames.indexOf("traceWidthSolver") - 1)
  expect(
    solver.pipelineDef.some(
      (step) => step.solverName === "exactGeometryDrcForceImproveSolver",
    ),
  ).toBeFalse()

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.highDensityRouteSolver?.includeBoardObstacles).toBeTrue()
  expect(
    Number(solver.portPointPathingSolver?.stats.preloadedFixedSegmentCount),
  ).toBeGreaterThan(0)
  const traceSimplificationStep = solver.pipelineDef.find(
    (step) => step.solverName === "traceSimplificationSolver",
  )
  const [traceSimplificationParams] =
    traceSimplificationStep!.getConstructorParams(solver)
  const immutableRoutes = (
    traceSimplificationParams as {
      otherHdRoutes?: Array<{ connectionName: string }>
    }
  ).otherHdRoutes
  expect(traceSimplificationParams).toMatchObject({
    minBoardEdgeClearance: 0.23,
    enableCrossingViaReduction: true,
  })
  expect(immutableRoutes?.length).toBeGreaterThan(0)
  expect(
    solver.traceSimplificationSolver?.simplifiedHdRoutes.some((route) =>
      immutableRoutes?.some(
        (immutableRoute) =>
          immutableRoute.connectionName === route.connectionName,
      ),
    ),
  ).toBe(false)
  const outputTraceIds = solver
    .getOutputSimplifiedPcbTraces()
    .map((trace) => trace.pcb_trace_id)
  expect(new Set(outputTraceIds).size).toBe(outputTraceIds.length)
})
