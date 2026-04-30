import { expect, test } from "bun:test"
import {
  MIN_VIA_TO_VIA_CLEARANCE,
  getDrcErrors,
} from "lib/testing/getDrcErrors"

const VIA_OUTER_DIAMETER = 0.3
const VIA_HOLE_DIAMETER = 0.15

const createViaPair = (centerDistance: number) =>
  [
    {
      type: "pcb_via",
      pcb_via_id: "via_a",
      x: 0,
      y: 0,
      outer_diameter: VIA_OUTER_DIAMETER,
      hole_diameter: VIA_HOLE_DIAMETER,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_via",
      pcb_via_id: "via_b",
      x: centerDistance,
      y: 0,
      outer_diameter: VIA_OUTER_DIAMETER,
      hole_diameter: VIA_HOLE_DIAMETER,
      layers: ["top", "bottom"],
    },
  ] as any[]

test("getDrcErrors reports different-net vias that are too close", () => {
  const circuitJson = createViaPair(VIA_HOLE_DIAMETER + 0.1 - 0.01)

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
  expect(locationAwareErrors[0].center).toEqual({ x: 0.12, y: 0 })
})

test("getDrcErrors enforces 0.1 minimum via-to-via clearance", () => {
  const centerDistance = VIA_HOLE_DIAMETER + MIN_VIA_TO_VIA_CLEARANCE - 0.01
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
  const centerDistance = VIA_HOLE_DIAMETER + MIN_VIA_TO_VIA_CLEARANCE
  const { errors } = getDrcErrors(createViaPair(centerDistance))

  expect(errors).toHaveLength(0)
})
