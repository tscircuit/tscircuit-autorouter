import { expect, test } from "bun:test"
import { createRegionalFallbackProblem } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("regional sections retain an immutable forest while user preloads remain movable", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "immutable-forest-sections", center: { x: 0, y: 0 }, width: 2, height: 2,
    availableZ: [0], portPoints: [
      { x: -1, y: 0.5, z: 0, connectionName: "target" },
      { x: 1, y: 0.5, z: 0, connectionName: "target" },
    ],
  }
  const routes: PreloadedHighDensityRoute[] = ["forest", "user-preload"].map((connectionName, index) => ({
    connectionName, traceThickness: 0.1, viaDiameter: 0.3, vias: [],
    route: [{ x: -1.2, y: index * 0.25, z: 0 }, { x: 1.2, y: index * 0.25, z: 0 }],
    preloadedTraceIndex: index, preloadedRouteIndex: 0,
  }))
  const legacy = createRegionalFallbackProblem(node, routes)
  expect([...legacy.fixedRouteSectionsByConnectionName.keys()]).toEqual(["forest", "user-preload"])
  const immutable = createRegionalFallbackProblem(node, routes, new Set(["forest"]), new Set([0]))
  expect([...immutable.fixedRouteSectionsByConnectionName.keys()]).toEqual(["user-preload"])
  expect(immutable.fixedObstacleRoutes).toEqual([routes[0]!])
  expect(immutable.fixedObstacleRoutes[0]).toBe(routes[0])
  expect(immutable.nodeWithPortPoints.portPoints).toHaveLength(4)
})
