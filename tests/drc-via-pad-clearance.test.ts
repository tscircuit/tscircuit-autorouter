import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("getDrcErrors checks via-to-pad copper clearance and retains its location", () => {
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "pcb_smtpad",
      pcb_smtpad_id: "pad",
      pcb_port_id: "port",
      shape: "rect",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      layer: "top",
    },
    {
      type: "pcb_via",
      pcb_via_id: "via",
      x: 0.8,
      y: 0,
      outer_diameter: 0.5,
      hole_diameter: 0.2,
      layers: ["top", "bottom"],
    },
  ]

  const result = getDrcErrors(circuitJson)
  expect(result.errors).toHaveLength(1)
  expect(result.errors[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_pad_ids: ["via", "pad"],
    minimum_clearance: 0.1,
  })
  const error = result.errors[0]
  if (error.type !== "pcb_pad_pad_clearance_error") {
    throw new Error("Expected a via-to-pad clearance error")
  }
  expect(error.actual_clearance).toBeCloseTo(0.05)
  expect(result.locationAwareErrors).toHaveLength(1)
  expect(result.locationAwareErrors[0].center.x).toBeCloseTo(0.525)
  expect(result.locationAwareErrors[0].center.y).toBeCloseTo(0)

  // Disabling trace-only clearance diagnostics must still check via copper.
  expect(
    getDrcErrors(circuitJson, {
      includeTypedTraceClearance: false,
    }).errors,
  ).toHaveLength(1)
  expect(
    getDrcErrors(circuitJson, {
      viaPadClearance: 0.04,
    }).errors,
  ).toEqual([])

  const pad = circuitJson[0]
  const via = circuitJson[1]
  if (pad.type !== "pcb_smtpad" || via.type !== "pcb_via") {
    throw new Error("Expected pad and via fixture elements")
  }
  expect(getDrcErrors([pad, { ...via, x: 0.6 }]).errors).toHaveLength(1)
  expect(getDrcErrors([pad, { ...via, x: 1 }]).errors).toEqual([])
  expect(getDrcErrors([pad, { ...via, layers: ["bottom"] }]).errors).toEqual([])
  expect(
    getDrcErrors([
      pad,
      { ...via, pcb_trace_id: "same_net_trace" },
      {
        type: "pcb_trace",
        pcb_trace_id: "same_net_trace",
        source_trace_id: "same_net_source_trace",
        route: [],
      },
      {
        type: "source_trace",
        source_trace_id: "same_net_source_trace",
        connected_source_port_ids: ["port"],
        connected_source_net_ids: [],
      },
    ]).errors,
  ).toEqual([])
})
