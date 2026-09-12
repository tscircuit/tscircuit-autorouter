import { expect, test } from "bun:test"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"

test("via pad and board clearance errors identify the movable routed trace", () => {
  const errors = normalizePipeline9DrcErrorsForRepair({
    errors: [
      { type: "pcb_pad_pad_clearance_error", pcb_pad_ids: ["via_1", "pad_1"] },
      { type: "pcb_placement_error", pcb_placement_error_id: "copper_too_close_to_board_edge_via_1" },
    ],
    circuitJson: [{ type: "pcb_via", pcb_via_id: "via_1", pcb_trace_id: "trace_1", x: 0, y: 0, outer_diameter: 0.3, hole_diameter: 0.2, layers: ["top", "bottom"] }],
    newTraceIds: new Set(["trace_1"]),
  })
  for (const error of errors) {
    expect(error.pcb_trace_id).toBe("trace_1")
    expect(error.pcb_via_ids).toEqual(["via_1"])
  }
})
