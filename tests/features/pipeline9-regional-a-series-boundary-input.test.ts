import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import {
  areAllPortPointsOnNodeBoundary,
  createRegionalFallbackProblem,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-regional-fallback"

test("Pipeline9 rejects interior fixed-route endpoints from its A-series regional fallback", () => {
  const fullyContainedRoute: PreloadedHighDensityRoute = {
    connectionName: "pipeline9_preloaded_drc_8",
    rootConnectionName: "connectivity_net5",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
    vias: [],
  }
  const problem = createRegionalFallbackProblem(
    {
      capacityMeshNodeId: "pipeline9_joint_drc_regular_fallback",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      availableZ: [0, 1],
      portPoints: [],
      portPointsInPairs: [],
    },
    [fullyContainedRoute],
  )

  expect(problem.nodeWithPortPoints.portPoints).toHaveLength(2)
  expect(areAllPortPointsOnNodeBoundary(problem.nodeWithPortPoints)).toBeFalse()
})
