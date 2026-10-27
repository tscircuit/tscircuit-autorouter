import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test(
  "via-pad copper clearance checks only layers carrying the declared via copper",
  (): void => {
    const via: AnyCircuitElement & { type: "pcb_via" } = {
      type: "pcb_via",
      pcb_via_id: "inner_signal_via",
      x: 0,
      y: 0,
      outer_diameter: 0.327,
      hole_diameter: 0.2,
      layers: ["inner1"],
      topmost_drill_layer: "top",
      bottommost_drill_layer: "bottom",
    }
    const pad: AnyCircuitElement & { type: "pcb_smtpad"; shape: "circle" } = {
      type: "pcb_smtpad",
      pcb_smtpad_id: "foreign_top_pad",
      pcb_component_id: "foreign_component",
      x: 0.444,
      y: 0,
      radius: 0.2,
      shape: "circle",
      layer: "top",
    }
    const options = { includeTraceContinuity: false, viaToPadClearance: 0.10668 }
    expect(getDrcErrors([via, pad], options).errors).toEqual([])

    via.layers = ["top", "inner1"]
    const errors = getDrcErrors([via, pad], options).errors
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      type: "pcb_pad_pad_clearance_error",
      pcb_pad_ids: [via.pcb_via_id, pad.pcb_smtpad_id],
      minimum_clearance: 0.10668,
    })

    const board: AnyCircuitElement & { type: "pcb_board" } = {
      type: "pcb_board",
      pcb_board_id: "board",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      thickness: 1.2,
      num_layers: 4,
      material: "fr4",
      min_pad_edge_to_pad_edge_clearance: 0.25,
    }
    pad.x = 0.5135
    const boardErrors = getDrcErrors([board, via, pad], {
      includeTraceContinuity: false,
      traceClearance: 0.05,
    }).errors
    expect(boardErrors).toHaveLength(1)
    expect(boardErrors[0]).toMatchObject({ minimum_clearance: 0.25 })
    expect(
      getDrcErrors([board, via, pad], {
        includeTraceContinuity: false,
        traceClearance: 0.05,
        viaToPadClearance: 0.1,
      }).errors,
    ).toEqual([])
  },
)
