import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("Pipeline9 only makes preloaded sections on target layers movable", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_target_layers",
    center: { x: 5, y: 5 },
    width: 10,
    height: 10,
    availableZ: [0, 1, 2],
    portPoints: [
      { x: 0, y: 4, z: 1, connectionName: "target" },
      { x: 10, y: 6, z: 1, connectionName: "target" },
    ],
  }
  const fixedRoutes: PreloadedHighDensityRoute[] = [
    {
      connectionName: "top_only",
      rootConnectionName: "top_only",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 2, z: 0 },
        { x: 10, y: 2, z: 0 },
      ],
      vias: [],
      preloadedTraceIndex: 0,
      preloadedRouteIndex: 0,
    },
    {
      connectionName: "touches_target_layer",
      rootConnectionName: "touches_target_layer",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 8, z: 0 },
        { x: 5, y: 8, z: 0 },
        { x: 5, y: 8, z: 1 },
        { x: 10, y: 8, z: 1 },
      ],
      vias: [{ x: 5, y: 8 }],
      preloadedTraceIndex: 1,
      preloadedRouteIndex: 0,
    },
    {
      connectionName: "touches_target_layer_outside_node",
      rootConnectionName: "touches_target_layer_outside_node",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 9, z: 0 },
        { x: 12, y: 9, z: 0 },
        { x: 12, y: 9, z: 1 },
      ],
      vias: [{ x: 12, y: 9 }],
      preloadedTraceIndex: 2,
      preloadedRouteIndex: 0,
    },
  ]

  const problem = createRegionalFallbackProblem(node, fixedRoutes)

  expect([...problem.fixedRouteSectionsByConnectionName.keys()]).toEqual([
    "touches_target_layer",
  ])
  expect(
    problem.fixedObstacleRoutes.map((route) => route.connectionName),
  ).toEqual(["top_only", "touches_target_layer_outside_node"])
  expect(problem.nodeWithPortPoints.portPoints).toHaveLength(4)
  expect(problem.nodeWithPortPoints.portPointsInPairs).toHaveLength(1)
})
