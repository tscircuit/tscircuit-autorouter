import { expect, test } from "bun:test"
import { checkCopperToBoardEdgeClearance } from "@tscircuit/checks"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("the physical concave outline governs circular vias even inside the board bounding box", (): void => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 }, minBoardEdgeClearance: 0,
    outline: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 },
      { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }],
    obstacles: [], connections: [{ name: "signal", pointsToConnect: [] }] }
  const placements = [
    { x: 2, y: 2, viaDiameter: 0.3, allowed: false },
    { x: 0.9, y: 2, viaDiameter: 0.3, allowed: false },
    { x: 0.85, y: 2, viaDiameter: 0.3, allowed: true },
    // A circle can clear an inward corner even though its bounding box cannot.
    { x: 0.85, y: 0.85, viaDiameter: 0.4, allowed: true },
    { x: 0.85, y: 0.85, viaDiameter: 0.5, allowed: false },
  ]
  for (const outline of [srj.outline!, [...srj.outline!].reverse(), [...srj.outline!, srj.outline![0]!]]) {
    const boardGeometry = { ...srj, outline }
    const validate = getPipeline9ViaPlacementValidator({ boardGeometry, boardObstacles: [],
      physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 })
    for (const placement of placements) {
      expect(validate({ ...placement, zStart: 1, zEnd: 2 }, "signal")).toBe(placement.allowed)
      const errors = checkCopperToBoardEdgeClearance([createPcbBoardElement(boardGeometry),
        { type: "pcb_via", pcb_via_id: "via", x: placement.x, y: placement.y,
          outer_diameter: placement.viaDiameter, hole_diameter: 0.15,
          layers: ["top", "inner1", "inner2", "bottom"] }])
      expect(errors.length === 0).toBe(placement.allowed)
    }
  }
})
