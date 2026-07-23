import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson } from "lib/types"
import scenario from "./preexisting-connected-traces/srj/preexisting-connected-traces06.srj.json" with {
  type: "json",
}

test("Pipeline9 projects preloaded copper into hypergraph regions without topology obstacles", () => {
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
  })
  expect(
    solver.capacityNodes?.some((node) =>
      node._connectedTo?.includes(preloadedTrace.connection_name),
    ),
  ).toBe(true)
  expect(solver.getOutputSimplifiedPcbTraces()).toHaveLength(1)
})
