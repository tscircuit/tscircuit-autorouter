import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("native world validation retains exact immutable blocker promotion and a valid coupled result", (): void => {
  const ports = [
    { x: -1, y: 0, z: 0, connectionName: "horizontal" }, { x: 1, y: 0, z: 0, connectionName: "horizontal" },
    { x: 0, y: -1, z: 0, connectionName: "vertical" }, { x: 0, y: 1, z: 0, connectionName: "vertical" },
  ]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "native-blocker-promotion", center: { x: 0, y: 0 },
    width: 2.1, height: 2.1, availableZ: [0], portPoints: ports,
    portPointsInPairs: [[ports[0]!, ports[1]!], [ports[2]!, ports[3]!]] }
  const fixed: PreloadedHighDensityRoute = { connectionName: "fixed-bottom", rootConnectionName: "fixed-bottom-root",
    traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -0.3, y: 0, z: 1 }, { x: 0.3, y: 0, z: 1 }],
    vias: [], preloadedTraceIndex: 0, preloadedRouteIndex: 0 }
  const connMap = new ConnectivityMap({})
  const solver = new Pipeline9HighDensitySolver({
    useNativeRegionalRouting: true, nodePortPoints: [node], fixedHdRoutes: [fixed], connMap,
    ...createSyntheticOriginalPhysicalContext({ connectionNames: ["horizontal", "vertical", "fixed-bottom"], connMap, layerCount: 2, obstacles: [] }),
    obstacles: [], layerCount: 2, viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1,
    obstacleMargin: 0.15, physicalTraceClearance: 0.1, effort: 0.1, cacheProvider: null,
  })
  while (!solver.activeFallbackSolver && !solver.failed) solver.step()
  expect(solver.activeFallbackFixedRouteSections.size).toBe(0)
  expect(solver.activeFallbackFixedObstacleRoutes).toEqual([fixed])
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBeTrue()
  expect(solver.stats.promotedFixedRouteCount).toBe(1)
  expect(solver.stats.promotedFallbackAttemptCount).toBe(1)
  expect(solver.getUpdatedFixedHdRoutes()[0]!.route[0]).toEqual(fixed.route[0])
  expect(solver.getUpdatedFixedHdRoutes()[0]!.route.at(-1)).toEqual(fixed.route.at(-1))
  expect(arePipeline9NativeRoutesPhysicallyValid({
    routes: solver.routes, immutableRoutes: solver.getUpdatedFixedHdRoutes(), connMap,
    layerCount: 2, traceClearance: 0.1, viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1, boardObstacles: [], viaToPadClearance: 0.1,
  })).toBeTrue()
})
