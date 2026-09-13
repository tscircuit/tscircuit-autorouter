import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  areAllPortPointsOnNodeBoundary,
  createRegionalFallbackProblem,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"

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

test("Pipeline9 expands a fallback region to include a promoted terminal blocker", () => {
  const outsideVia: PreloadedHighDensityRoute = {
    connectionName: "outside-terminal-via",
    rootConnectionName: "outside-net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    traceThickness: 0.1,
    viaDiameter: 0.5,
    route: [
      { x: 1.7, y: 0, z: 0 },
      { x: 1.7, y: 0, z: 1 },
    ],
    vias: [{ x: 1.7, y: 0 }],
  }
  const problem = createRegionalFallbackProblem(
    {
      capacityMeshNodeId: "terminal-blocker-expansion",
      center: { x: 0, y: 0 },
      width: 3,
      height: 3,
      availableZ: [0, 1],
      portPoints: [],
      portPointsInPairs: [],
    },
    [outsideVia],
    new Set([outsideVia.connectionName]),
    0.3,
  )

  expect(problem.nodeWithPortPoints.width).toBe(3.6)
  expect(problem.nodeWithPortPoints.height).toBe(3.6)
  expect(
    problem.fixedRouteSectionsByConnectionName.has(outsideVia.connectionName),
  ).toBeTrue()
  expect(problem.fixedObstacleRoutes).toHaveLength(0)
})
