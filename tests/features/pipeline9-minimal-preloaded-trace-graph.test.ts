import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "./preexisting-connected-traces/srj/preexisting-connected-traces06.srj.json" with {
  type: "json",
}

test("Pipeline9 owns copied stages with minimal preloaded-trace changes", () => {
  const srj = structuredClone(scenario) as SimpleRouteJson
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
  expect(solver.preloadedTraceGraphSolver?.stats).toMatchObject({
    preloadedTraceCount: 1,
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
    (step) => step.solverName !== "powerTraceExpansionSolver",
  ).length
  expect(solver.pipelineDef).toHaveLength(pipeline7SharedStageCount + 1)
  for (const stageName of [
    "highDensityRouteSolver",
    "highDensityRepairSolver",
    "highDensityStitchSolver",
    "globalDrcForceImproveSolver",
    "exactGeometryDrcForceImproveSolver",
  ]) {
    expect(
      solver.pipelineDef.find((step) => step.solverName === stageName)
        ?.solverClass as unknown,
    ).toBe(pipeline7Stages.get(stageName))
  }

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    Number(solver.portPointPathingSolver?.stats.preloadedFixedSegmentCount),
  ).toBeGreaterThan(0)
  const highDensityStep = solver.pipelineDef.find(
    (step) => step.solverName === "highDensityRouteSolver",
  )
  const [highDensityParams] = highDensityStep!.getConstructorParams(solver)
  expect(
    "growShrinkFallbackToInvalidGeometryOnFailure" in highDensityParams,
  ).toBe(false)
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
  expect(immutableRoutes?.length).toBeGreaterThan(0)
  expect(
    solver.traceSimplificationSolver?.simplifiedHdRoutes.some((route) =>
      immutableRoutes?.some(
        (immutableRoute) =>
          immutableRoute.connectionName === route.connectionName,
      ),
    ),
  ).toBe(false)
})
