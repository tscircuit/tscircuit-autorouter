import { expect, test } from "bun:test"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("getDrcErrors reports different-net vias that are too close", () => {
  const circuitJson = [
    {
      type: "pcb_via",
      pcb_via_id: "via_a",
      x: 0,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_via",
      pcb_via_id: "via_b",
      x: 0.35,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "bottom"],
    },
  ] as any[]

  const { errors, locationAwareErrors } = getDrcErrors(circuitJson, {
    viaClearance: 0.1,
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_via_clearance_error",
    error_type: "pcb_via_clearance_error",
    pcb_error_id: "different_net_vias_close_via_a_via_b",
    pcb_via_ids: ["via_a", "via_b"],
  })
  expect(locationAwareErrors).toHaveLength(1)
  expect(locationAwareErrors[0].center).toEqual({ x: 0.175, y: 0 })
})
