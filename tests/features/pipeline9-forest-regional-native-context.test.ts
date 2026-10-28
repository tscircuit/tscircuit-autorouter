import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { Obstacle } from "lib/types"

test("regional native routing retains physical board, drill, cache, and preload-via validation context", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "physical-context", center: { x: 0, y: 0 }, width: 4, height: 4,
    availableZ: [0, 1, 2, 3], portPoints: [
      { x: -2, y: -1, z: 2, connectionName: "native", rootConnectionName: "native" },
      { x: 2, y: -1, z: 2, connectionName: "native", rootConnectionName: "native" },
    ],
  }
  const boardGeometry: HighDensityBoardGeometry = {
    bounds: { minX: -8, maxX: 8, minY: -6, maxY: 6 }, minBoardEdgeClearance: 0.23,
    outline: [{ x: -8, y: -6 }, { x: 8, y: -6 }, { x: 7, y: 6 }, { x: -8, y: 6 }],
  }
  const obstacle: Obstacle = { type: "rect", obstacleId: "foreign-top-pad", center: { x: 0, y: 0 },
    width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["foreign"], ccwRotationDegrees: 20 }
  for (const allowBlindAndBuriedVias of [true, false]) {
    const outer = new Pipeline9HighDensitySolver({
      useNativeRegionalRouting: true,
      nodePortPoints: [node], fixedHdRoutes: [{ connectionName: "forest-fixed", rootConnectionName: "forest",
        traceThickness: 0.12, viaDiameter: 0.55, route: [{ x: -2, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }],
        vias: [], preloadedTraceIndex: 0, preloadedRouteIndex: 0 }],
      connMap: new ConnectivityMap({ ownedNative: ["native"], ownedForest: ["forest", "forest-fixed"], foreignNet: ["foreign"] }),
      colorMap: {}, obstacles: [obstacle], layerCount: 4, traceWidth: 0.12, viaDiameter: 0.55,
      viaHoleDiameter: 0.22, minViaHoleEdgeToViaHoleEdgeClearance: 0.27, viaToPadClearance: 0.19,
      obstacleMargin: 0.17, effort: 0.2, boardGeometry, allowBlindAndBuriedVias, cacheProvider: null,
    })
    outer.activeNode = node
    ;(outer as unknown as { startRegionalFallback(): void }).startRegionalFallback()
    const regional = outer.activeFallbackSolver!
    const native = regional.highDensitySolver
    expect(native.boardGeometry).toBe(boardGeometry)
    expect(native.boardGeometry!.bounds).not.toEqual({ minX: -2, maxX: 2, minY: -2, maxY: 2 })
    expect(native.layerCount).toBe(4)
    expect(native.traceWidth).toBe(0.12)
    expect(native.viaDiameter).toBe(0.55)
    expect(native.obstacleMargin).toBe(0.17)
    expect(native.cacheProvider).toBeNull()
    expect(native.priorityDagOptions).toEqual({ priorityDagSearch: true, viaHoleDiameter: 0.22,
      minViaHoleEdgeToViaHoleEdgeClearance: 0.27, allowBlindAndBuriedVias })
    expect(native.benchmarkDiagnosticCounters).toBe(outer.benchmarkDiagnosticCounters)
    expect(native.obstacles).toContain(obstacle)
    expect(regional.params.boardObstacles).toEqual([obstacle])
    expect(regional.params.movablePreloadedConnectionNames!.has("forest-fixed")).toBe(true)
    const validate = native.growShrinkSolutionValidator!
    expect(typeof validate).toBe("function")
    const innerVia: HighDensityRoute = { connectionName: "forest-fixed", rootConnectionName: "forest",
      traceThickness: 0.12, viaDiameter: 0.55, route: [{ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: 3 }],
      vias: [{ x: 0, y: 0 }] }
    // An inner/bottom blind span clears the foreign top pad; the corresponding
    // full-stack via must still be rejected by the original regional guard.
    expect(validate([innerVia])).toBe(allowBlindAndBuriedVias)
    const topVia: HighDensityRoute = { ...innerVia, route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
      vias: [{ x: 0, y: 0 }] }
    expect(validate([topVia])).toBe(false)
    expect(regional.stats.preloadedViaCandidateRejectionCount).toBe(allowBlindAndBuriedVias ? 1 : 2)
    const clearVia: HighDensityRoute = { ...innerVia, route: [{ x: 1, y: 1, z: 2 }, { x: 1, y: 1, z: 3 }],
      vias: [{ x: 1, y: 1 }] }
    expect(validate([clearVia])).toBe(true)
  }
})
