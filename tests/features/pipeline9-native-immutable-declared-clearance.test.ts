import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("immutable candidate acceptance applies explicit physical clearance independently of the search margin", (): void => {
  const ports = [{ x: -1, y: 0.35, z: 0, connectionName: "new" }, { x: 1, y: 0.35, z: 0, connectionName: "new" }]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "declared-immutable-rule", center: { x: 0, y: 0 },
    width: 2.2, height: 2.2, availableZ: [0], portPoints: ports, portPointsInPairs: [[ports[0]!, ports[1]!]] }
  const candidate: HighDensityRoute = { connectionName: "new", traceThickness: 0.1, viaDiameter: 0.3,
    route: [ports[0]!, { x: -0.8, y: 0.35, z: 0 }, { x: -0.8, y: 0.35, z: 1 },
      { x: 0.8, y: 0.35, z: 1 }, { x: 0.8, y: 0.35, z: 0 }, ports[1]!],
    vias: [{ x: -0.8, y: 0.35 }, { x: 0.8, y: 0.35 }] }
  const connMap = new ConnectivityMap({})
  for (const physicalTraceClearance of [0.05, 0.3]) {
    const solver = new Pipeline9HighDensitySolver({
      useNativeRegionalRouting: true, nodePortPoints: [node], fixedHdRoutes: [{
        connectionName: "fixed", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: -0.3, y: 0, z: 1 }, { x: 0.3, y: 0, z: 1 }], vias: [],
        preloadedTraceIndex: 0, preloadedRouteIndex: 0,
      }], connMap, ...createSyntheticOriginalPhysicalContext({ connectionNames: ["new", "fixed"], connMap, layerCount: 2, obstacles: [] }), obstacles: [], layerCount: 2,
      viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1, obstacleMargin: 0.15,
      physicalTraceClearance, effort: 0.1, cacheProvider: null,
    })
    solver.activeNode = node
    Reflect.get(solver, "startRegionalFallback").call(solver)
    expect(solver.activeFallbackFixedRouteSections.size).toBe(0)
    solver.activeFallbackSolver!.getOutput = (): HighDensityRoute[] => [candidate]
    Reflect.get(solver, "finishRegionalFallback").call(solver)
    expect(solver.obstacleMargin).toBe(0.15)
    expect(solver.failed).toBeFalse()
    expect(solver.stats.promotedFallbackAttemptCount).toBe(physicalTraceClearance === 0.3 ? 1 : 0)
    expect(solver.routes.length).toBe(physicalTraceClearance === 0.05 ? 1 : 0)
  }
})
