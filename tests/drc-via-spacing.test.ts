import { expect, test } from "bun:test"
import {
  MIN_VIA_TO_VIA_CLEARANCE,
  getDrcErrors,
} from "lib/testing/getDrcErrors"

const createViaPair = (centerDistance: number) =>
  [
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
      x: centerDistance,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "bottom"],
    },
  ] as any[]

test("getDrcErrors reports different-net vias that are too close", () => {
  const circuitJson = createViaPair(0.35)

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

test("getDrcErrors enforces 0.1 minimum via-to-via clearance", () => {
  const centerDistance = 0.3 + MIN_VIA_TO_VIA_CLEARANCE - 0.01
  const { errors } = getDrcErrors(createViaPair(centerDistance), {
    viaClearance: 0.05,
  })

  expect(errors).toHaveLength(1)
  expect(errors[0]).toMatchObject({
    type: "pcb_via_clearance_error",
    pcb_via_ids: ["via_a", "via_b"],
  })
})

test("getDrcErrors allows vias at 0.1 clearance", () => {
  const centerDistance = 0.3 + MIN_VIA_TO_VIA_CLEARANCE
  const { errors } = getDrcErrors(createViaPair(centerDistance))

  expect(errors).toHaveLength(0)
})
