import { createSyntheticOriginalPhysicalContext } from "../fixtures/physical-forest-regional/createSyntheticOriginalPhysicalContext"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { arePipeline9NativeRoutesPhysicallyValid } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/arePipeline9NativeRoutesPhysicallyValid"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("B01 full-stack vias cannot be accepted through foreign pads on excluded topology layers", (): void => {
  const ports = [{ x: -0.8, y: 0, z: 1, connectionName: "signal" }, { x: 0.8, y: 0, z: 3, connectionName: "signal" }]
  const node: NodeWithPortPoints = { capacityMeshNodeId: "b01-through-via", center: { x: 0, y: 0 },
    width: 2.2, height: 2.2, availableZ: [1, 3], portPoints: ports, portPointsInPairs: [[ports[0]!, ports[1]!]] }
  const pad: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 3, height: 3,
    layers: ["top"], connectedTo: ["foreign-pad"] }
  for (const allowBlindAndBuriedVias of [false, true]) {
    const connMap = new ConnectivityMap({})
    const solver = new Pipeline9HighDensitySolver({ useNativeRegionalRouting: true, nodePortPoints: [node],
      fixedHdRoutes: [{ connectionName: "forest", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: -0.5, y: 0.85, z: 1 }, { x: 0.5, y: 0.85, z: 1 }], vias: [],
        preloadedTraceIndex: 0, preloadedRouteIndex: 0 }], immutablePreloadedTraceIndices: [0],
      connMap, ...createSyntheticOriginalPhysicalContext({ connectionNames: ["signal", "forest", "foreign-pad"], connMap, layerCount: 4, obstacles: [pad] }), obstacles: [pad], layerCount: 4, allowBlindAndBuriedVias,
      viaDiameter: 0.3, viaHoleDiameter: 0.15, traceWidth: 0.1, obstacleMargin: 0.15,
      effort: 0.1, includeBoardObstacles: true, enableRegionalFallback: false, cacheProvider: null })
    solver.step()
    const b01 = solver.activeB01Solver!
    expect(b01).not.toBeNull()
    b01.solve()
    expect(b01.solved).toBeTrue()
    const output = b01.getOutput()
    expect(output[0]!.vias.length).toBeGreaterThan(0)
    expect(arePipeline9NativeRoutesPhysicallyValid({ routes: output, connMap, layerCount: 4,
      allowBlindAndBuriedVias, traceClearance: 0.1, viaHoleDiameter: 0.15,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.1, boardObstacles: [pad], viaToPadClearance: 0.1 }))
      .toBe(allowBlindAndBuriedVias)
    solver.step()
    expect(solver.routes.length).toBe(allowBlindAndBuriedVias ? 1 : 0)
    expect(solver.failed).toBe(!allowBlindAndBuriedVias)
    if (!allowBlindAndBuriedVias) expect(solver.error).toContain("B01 output failed physical validation")
  }
})
