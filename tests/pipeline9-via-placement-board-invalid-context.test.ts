import { expect, test } from "bun:test"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("invalid original board constraints fail loudly before via search", (): void => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    obstacles: [], connections: [] }
  const context = { boardGeometry: srj, boardObstacles: [],
    physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 }
  const invalid: HighDensityBoardGeometry[] = [
    { ...srj, minBoardEdgeClearance: NaN }, { ...srj, minBoardEdgeClearance: -0.01 },
    { ...srj, bounds: { ...srj.bounds, minX: Infinity } },
    { ...srj, bounds: { ...srj.bounds, maxY: -1 } },
    { ...srj, outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { ...srj, outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] },
    { ...srj, outline: [{ x: 0, y: 0 }, { x: 1, y: NaN }, { x: 0, y: 1 }] },
  ]
  for (const boardGeometry of invalid) {
    expect(() => getPipeline9ViaPlacementValidator({ ...context, boardGeometry })).toThrow("Invalid original via-placement board")
  }
})
