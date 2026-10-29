import { expect, test } from "bun:test"
import { checkCopperToBoardEdgeClearance, checkViasOffBoard } from "@tscircuit/checks"
import type { PcbVia } from "circuit-json"
import { getPipeline9PhysicalOwnership } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import { getPipeline9ViaPlacementValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("via board clearance uses original-input rule semantics and the pinned comparison tolerance", (): void => {
  const srj: SimpleRouteJson = { layerCount: 4, minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    obstacles: [], connections: [{ name: "signal", pointsToConnect: [] }] }
  for (const minBoardEdgeClearance of [undefined, 0, 0.2]) {
    const boardGeometry = { ...srj, minBoardEdgeClearance }
    const validate = getPipeline9ViaPlacementValidator({ boardGeometry, boardObstacles: [],
      physicalOwnership: getPipeline9PhysicalOwnership({ originalSrj: srj }), layerCount: 4, clearance: 0.1 })
    const evaluated = evaluateRelaxedDrc({ inputSrj: boardGeometry, srjWithPointPairs: boardGeometry,
      routedTraces: [], includeBoardClearance: true })
    const clearance = minBoardEdgeClearance ?? 0
    expect(evaluated.circuitJson.find((element) => element.type === "pcb_board")!.min_board_edge_clearance).toBe(clearance)
    const cases = clearance === 0
      ? [[-1e-6, true], [0, true], [0.5e-9, true], [2e-6, false]] as const
      : [[-1e-6, true], [0, true], [0.5e-9, true], [2e-9, false], [1e-6, false]] as const
    for (const [shortfall, allowed] of cases) {
      const via = { x: 1 - 0.15 - clearance + shortfall, y: 0, zStart: 1, zEnd: 2, viaDiameter: 0.3 }
      expect(validate(via, "signal")).toBe(allowed)
      const element: PcbVia = { type: "pcb_via", pcb_via_id: "via", x: via.x, y: via.y,
        outer_diameter: via.viaDiameter, hole_diameter: 0.15,
        layers: ["top", "inner1", "inner2", "bottom"] }
      const circuitJson = [...evaluated.circuitJson, element]
      expect(checkCopperToBoardEdgeClearance(circuitJson).length === 0).toBe(allowed)
      expect(checkViasOffBoard(circuitJson).length === 0).toBe(allowed)
    }
  }
})
