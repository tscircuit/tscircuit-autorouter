import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("regular native search protects certified top copper from an inner-layer manufactured through via", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "inner-node", center: { x: 0, y: 0 }, width: 3, height: 3,
    availableZ: [1, 3],
    portPoints: [
      { x: -1, y: 0, z: 1, connectionName: "new" },
      { x: 1, y: 0, z: 3, connectionName: "new" },
    ],
  }
  const fragment: HighDensityIntraNodeRoute = {
    connectionName: "new", regionId: "inner-node", traceThickness: 0.15, viaDiameter: 0.3,
    route: [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 3 }], vias: [{ x: 0, y: 0 }],
  }
  const connMap = new ConnectivityMap({ new: ["new"], fixed: ["fixed"] })
  const params: ConstructorParameters<typeof Pipeline9HighDensitySolver>[0] = {
    nodePortPoints: [node], fixedHdRoutes: [{
      connectionName: "fixed", preloadedTraceIndex: 0, preloadedRouteIndex: 0, traceThickness: 0.15, viaDiameter: 0.3,
      route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [],
    }],
    connMap, ...createSyntheticOriginalPhysicalContext({ connectionNames: ["new", "fixed"], connMap, layerCount: 4, obstacles: [] }),
    obstacles: [], layerCount: 4, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15,
    effort: 0.1, cacheProvider: null, useNativeRegionalRouting: true,
  }
  const immutable = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [node], fixedHdRoutes: [...params.fixedHdRoutes],
    immutablePreloadedTraceIndices: [0] })
  Reflect.get(immutable, "startRegularSolver").call(immutable, node)
  expect(immutable.activeRegularSolver!.routeFragmentValidator!(fragment)).toBeFalse()
  expect(immutable.activeRegularSolver!.routeFragmentValidator!({ ...fragment,
    route: fragment.route.map((p) => ({ ...p, y: 1 })), vias: [{ x: 0, y: 1 }] })).toBeTrue()
  const movable = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [node], fixedHdRoutes: [...params.fixedHdRoutes] })
  Reflect.get(movable, "startRegularSolver").call(movable, node)
  expect(movable.activeRegularSolver!.routeFragmentValidator!(fragment)).toBeTrue()
  const { physicalOwnership: _, physicalBoardObstacles: __, ...legacyParams } = params
  const legacyImmutable = new Pipeline9HighDensitySolver({ ...legacyParams, immutablePreloadedTraceIndices: [0] })
  Reflect.get(legacyImmutable, "startRegularSolver").call(legacyImmutable, node)
  expect(legacyImmutable.hasOriginalPhysicalContext).toBeFalse()
  expect(legacyImmutable.activeRegularSolver!.routeFragmentValidator!(fragment)).toBeFalse()
  expect(legacyImmutable.activeRegularSolver!.routeFragmentValidator!({ ...fragment,
    route: fragment.route.map((p) => ({ ...p, y: 1 })), vias: [{ x: 0, y: 1 }] })).toBeTrue()

  const planar = (connectionName: string, y: number, z: number): HighDensityIntraNodeRoute => ({
    ...fragment, connectionName, route: [{ x: -1, y, z }, { x: 1, y, z }], vias: [],
  })
  const legacyAcceptance = legacyImmutable.activeRegularSolver!.solutionValidator!
  expect(legacyAcceptance([planar("new", 0, 1), planar("other", 0.27, 1)])).toBeTrue()
  expect(legacyAcceptance([planar("new", 0, 1), planar("other", 0.24, 1)])).toBeFalse()
  expect(legacyAcceptance([planar("new", 0.26, 0)])).toBeFalse()
  expect(legacyAcceptance([planar("new", 0.31, 0)])).toBeTrue()

})
