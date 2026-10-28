import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("a feasible foreign regional route leaves protected forest copper unchanged through cleanup", (): void => {
  const ports = [{ x: -1, y: 0.6, z: 0, connectionName: "foreign" }, { x: 1, y: 0.6, z: 0, connectionName: "foreign" }]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "immutable-forest-feasible", center: { x: 0, y: 0 },
    width: 2.2, height: 2.2, availableZ: [0], portPoints: ports, portPointsInPairs: [[ports[0]!, ports[1]!]] }
  const forest: PreloadedHighDensityRoute = { connectionName: "forest", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [], preloadedTraceIndex: 3, preloadedRouteIndex: 0 }
  const before = JSON.stringify(forest)
  const connMap = new ConnectivityMap({})
  const solver = new Pipeline9HighDensitySolver({ useNativeRegionalRouting: true, nodePortPoints: [],
    fixedHdRoutes: [forest], immutablePreloadedTraceIndices: [3], connMap, ...createSyntheticOriginalPhysicalContext({ connectionNames: ["foreign", "forest"], connMap, layerCount: 2, obstacles: [] }), obstacles: [], layerCount: 2,
    viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1, obstacleMargin: 0.15,
    physicalTraceClearance: 0.1, effort: 0.1, cacheProvider: null })
  solver.activeNode = node
  Reflect.get(solver, "startRegionalFallback").call(solver)
  expect(solver.activeFallbackFixedRouteSections.size).toBe(0)
  expect(solver.activeFallbackFixedObstacleRoutes).toEqual([forest])
  expect(solver.activeFallbackSolver!.params.immutableRoutes).toEqual([forest])
  solver.solve()
  expect(solver.error).toBeNull()
  expect(solver.solved).toBeTrue()
  expect(solver.routes).toHaveLength(1)
  expect(solver.fixedRouteReplacements.size).toBe(0)
  expect(solver.removedFixedRouteConnectionNames.size).toBe(0)
  expect(solver.preloadedTraceMutationMasks.size).toBe(0)
  expect(solver.getUpdatedFixedHdRoutes()[0]).toBe(forest)
  expect(JSON.stringify(forest)).toBe(before)
  expect(arePipeline9NativeRoutesPhysicallyValid({ routes: solver.routes, immutableRoutes: [forest], connMap,
    layerCount: 2, traceClearance: 0.1, viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    boardObstacles: [], viaToPadClearance: 0.1 })).toBeTrue()
})
