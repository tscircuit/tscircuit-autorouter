import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("B01 inner wires must respect all-stack nonplated holes before promotion", (): void => {
  const ports = [{ x: -0.8, y: 0, z: 1, connectionName: "signal" }, { x: 0.8, y: 0, z: 1, connectionName: "signal" }]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "b01-inner-hole", center: { x: 0, y: 0 },
    width: 2.2, height: 2.2, availableZ: [1], portPoints: ports, portPointsInPairs: [[ports[0]!, ports[1]!]] }
  for (const holeY of [0, -0.8]) {
    const hole: Obstacle = { type: "rect", shape: "circle", isNonPlatedHole: true,
      center: { x: 0, y: holeY }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["signal"] }
    const connMap = new ConnectivityMap({})
    const solver = new Pipeline9HighDensitySolver({ useNativeRegionalRouting: true, nodePortPoints: [node],
      fixedHdRoutes: [{ connectionName: "forest", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: -0.5, y: 0.85, z: 1 }, { x: 0.5, y: 0.85, z: 1 }], vias: [],
        preloadedTraceIndex: 0, preloadedRouteIndex: 0 }], immutablePreloadedTraceIndices: [0],
      connMap, ...createSyntheticOriginalPhysicalContext({ connectionNames: ["signal", "forest"], connMap, layerCount: 4, obstacles: [hole] }), obstacles: [hole], layerCount: 4, viaDiameter: 0.3, viaHoleDiameter: 0.15,
      traceWidth: 0.1, obstacleMargin: 0.15, effort: 0.1, includeBoardObstacles: true,
      enableRegionalFallback: true, cacheProvider: null })
    solver.step()
    const b01 = solver.activeB01Solver!
    b01.solve()
    expect(b01.solved).toBeTrue()
    expect(arePipeline9NativeRoutesPhysicallyValid({ routes: b01.getOutput(), connMap, layerCount: 4,
      traceClearance: 0.1, viaHoleDiameter: 0.15, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
      boardObstacles: [hole], viaToPadClearance: 0.1 })).toBe(holeY !== 0)
    solver.step()
    expect(solver.failed).toBeFalse()
    expect(solver.routes.length).toBe(holeY === 0 ? 0 : 1)
    expect(solver.activeFallbackSolver !== null).toBe(holeY === 0)
    if (holeY === 0) {
      expect(solver.activeFallbackReason).toContain("B01 output failed physical validation")
      expect(solver.stats.b01PhysicalCandidateRejectionCount).toBe(1)
    }
    expect(solver.fixedRouteReplacements.size).toBe(0)
  }
})
