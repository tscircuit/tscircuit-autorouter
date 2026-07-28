import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "./preexisting-connected-traces/srj/preexisting-connected-traces06.srj.json" with {
  type: "json",
}

test("Pipeline9 loads preexisting copper into ports without changing capacity topology", () => {
  const srj = structuredClone(scenario) as SimpleRouteJson
  const preloadedTrace = srj.traces?.[0]
  if (!preloadedTrace) {
    throw new Error("Expected the Pipeline9 fixture to contain a trace")
  }

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    targetMinCapacity: 0.75,
    maxNodeDimension: 3,
    effort: 0.5,
  })
  const traceFreeSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    { ...structuredClone(srj), traces: undefined },
    {
      targetMinCapacity: 0.75,
      maxNodeDimension: 3,
      effort: 0.5,
    },
  )
  while (
    !traceFreeSolver.failed &&
    !traceFreeSolver.preloadedTraceGraphSolver?.solved
  ) {
    traceFreeSolver.step()
  }
  solver.solve()

  const preprocessedSrj =
    solver.preprocessSimpleRouteJsonSolver?.getOutputSimpleRouteJson()
  expect(
    preprocessedSrj?.obstacles.some((obstacle) =>
      obstacle.obstacleId?.startsWith("trace_obstacle_"),
    ),
  ).toBe(false)
  expect(preprocessedSrj?.traces).toEqual(srj.traces)
  expect(solver.preloadedTraceGraphSolver?.stats).toMatchObject({
    preloadedTraceCount: 1,
    preloadedTraceShapeCount: 1,
    topologyChanged: false,
  })
  const getCapacityTopology = (
    pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ) =>
    pipeline.capacityNodes?.map((node) => ({
      capacityMeshNodeId: node.capacityMeshNodeId,
      center: node.center,
      width: node.width,
      height: node.height,
      layer: node.layer,
      availableZ: node.availableZ,
      adjacentNodeIds: node._adjacentNodeIds,
    }))
  const getPortTopology = (
    pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  ) =>
    pipeline.preloadedTraceGraphSolver?.getOutput().map((segment) => ({
      edgeId: segment.edgeId,
      nodeIds: segment.nodeIds,
      start: segment.start,
      end: segment.end,
      availableZ: segment.availableZ,
      ports: segment.portPoints.map((portPoint) => ({
        segmentPortPointId: portPoint.segmentPortPointId,
        x: portPoint.x,
        y: portPoint.y,
        availableZ: portPoint.availableZ,
        nodeIds: portPoint.nodeIds,
        edgeId: portPoint.edgeId,
        distToCentermostPortOnZ: portPoint.distToCentermostPortOnZ,
        cramped: portPoint.cramped,
      })),
    }))
  expect(getCapacityTopology(solver)).toEqual(
    getCapacityTopology(traceFreeSolver),
  )
  expect(getPortTopology(solver)).toEqual(getPortTopology(traceFreeSolver))
  expect(
    solver.preloadedTraceGraphSolver
      ?.getOutput()
      .flatMap((segment) => segment.portPoints)
      .some((portPoint) =>
        portPoint._preloadedFixedNetIds?.includes(srj.connections[0]!.name),
      ),
  ).toBe(true)
  expect(
    Number(solver.portPointPathingSolver?.stats.preloadedPortCount),
  ).toBeGreaterThan(0)
  expect(
    solver.capacityNodes?.some((node) =>
      node.capacityMeshNodeId.includes("__preloaded_"),
    ),
  ).toBe(false)
  expect(
    solver.capacityNodes?.some(
      (node) => (node._preloadedFixedNetIds?.length ?? 0) > 0,
    ),
  ).toBe(false)
  const traceSimplificationStep = solver.pipelineDef.find(
    (candidate) => candidate.solverName === "traceSimplificationSolver",
  )
  const [traceSimplificationParams] =
    traceSimplificationStep!.getConstructorParams(solver)
  const immutablePreloadedRoutes = (
    traceSimplificationParams as {
      otherHdRoutes?: Array<{ connectionName: string }>
    }
  ).otherHdRoutes
  expect(immutablePreloadedRoutes?.length).toBeGreaterThan(0)
  expect(
    solver.traceSimplificationSolver?.simplifiedHdRoutes.some((route) =>
      immutablePreloadedRoutes?.some(
        (fixedRoute) => fixedRoute.connectionName === route.connectionName,
      ),
    ),
  ).toBe(false)
  for (const solverName of [
    "uniformPortDistributionSolver",
    "highDensityRouteSolver",
    "highDensityRepairSolver",
    "traceSimplificationSolver",
    "lengthMatchingSolver",
    "traceWidthSolver",
    "globalDrcForceImproveSolver",
    "exactGeometryDrcForceImproveSolver",
  ]) {
    const step = solver.pipelineDef.find(
      (candidate) => candidate.solverName === solverName,
    )
    expect(step, `Expected Pipeline9 stage ${solverName}`).toBeDefined()
    const [rawParams] = step!.getConstructorParams(solver)
    const params = rawParams as {
      obstacles?: Array<{ obstacleId?: string }>
      srj?: { obstacles?: Array<{ obstacleId?: string }> }
    }
    const obstacles = params.obstacles ?? params.srj?.obstacles ?? []
    expect(
      obstacles.some((obstacle: { obstacleId?: string }) =>
        obstacle.obstacleId?.startsWith("trace_obstacle_"),
      ),
      `${solverName} should not receive approximation rectangles for preloaded traces`,
    ).toBe(false)
    const stageSolver = (
      solver as unknown as Record<
        string,
        { visualize: () => { rects?: unknown[] } } | undefined
      >
    )[solverName]
    expect(
      stageSolver,
      `Expected instantiated Pipeline9 stage ${solverName}`,
    ).toBeDefined()
    expect(
      (stageSolver!.visualize().rects ?? []).some((rect) =>
        JSON.stringify(rect).includes("trace_obstacle_"),
      ),
      `${solverName} should not visualize approximation rectangles for preloaded traces`,
    ).toBe(false)
  }
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(1)
})
