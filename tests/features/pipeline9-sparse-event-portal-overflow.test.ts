import { expect, test } from "bun:test"
import { createSparseClearanceEventSearch } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/createSparseClearanceEventSearch"

test("lazy portal extent indexing rejects finite frames whose padded transform overflows", (): void => {
  for (const rotation of [0, Math.PI / 4]) {
    const search = createSparseClearanceEventSearch({
      bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
      start: { x: 0.5, y: 0.5, z: 0 }, end: { x: 1.5, y: 1.5, z: 0 },
      barriers: [], additionalCostSupports: [{
        minX: -1.5e308, maxX: 1.5e308, minY: -1.5e308, maxY: 1.5e308, minZ: 0, maxZ: 0,
        orientation: { x: 0, y: 0, cos: Math.cos(rotation), sin: Math.sin(rotation),
          halfWidth: rotation === 0 ? Number.MAX_VALUE : 1.5e308, halfHeight: 1.5e308 },
      }],
      grid: 0.1, layerCount: 1, traceThickness: 0.1, wireReach: 0.2, viaReach: 0.3,
      drillSpacing: 0.4, allowLayerChanges: false, maxNodes: 100, heuristicWeight: 3,
      clear: (): boolean => true, extraCost: (): number => 0,
      finish: (): void => { throw new Error("An invalid portal extent reached search completion") },
    })
    expect(() => { for (let step = 0; step < 10000; step++) search.step() }).toThrow("Sparse support portal extent is nonfinite")
  }
})
