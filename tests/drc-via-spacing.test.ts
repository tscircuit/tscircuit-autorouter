import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import {
  MIN_VIA_TO_VIA_CLEARANCE,
  getDrcErrors,
} from "lib/testing/getDrcErrors"

const VIA_OUTER_DIAMETER = 0.3
const VIA_HOLE_DIAMETER = 0.15
const TRACE_WIDTH = 0.1
const VIA_TO_TRACE_CLEARANCE = 0.1

const createViaPair = (centerDistance: number): AnyCircuitElement[] => {
  return [
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
  ]
}

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

test("getDrcErrors reports vias too close to unrelated traces", () => {
  const traceCenterX =
    VIA_OUTER_DIAMETER / 2 + TRACE_WIDTH / 2 + VIA_TO_TRACE_CLEARANCE - 0.01
  const circuitJson: AnyCircuitElement[] = [
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
      type: "pcb_trace",
      pcb_trace_id: "trace_a",
      source_trace_id: "source_trace_a",
      route: [
        {
          route_type: "wire",
          x: traceCenterX,
          y: -1,
          width: TRACE_WIDTH,
          layer: "top",
        },
        {
          route_type: "wire",
          x: traceCenterX,
          y: 1,
          width: TRACE_WIDTH,
          layer: "top",
        },
      ],
    },
  ]

  const { errors, errorsWithCenters, locationAwareErrors } = getDrcErrors(
    circuitJson,
    {
      traceClearance: VIA_TO_TRACE_CLEARANCE,
      viaClearance: 0.05,
    },
  )

  expect(errors).toHaveLength(1)
  const viaTraceError = errors.find(
    (error) => error.type === "pcb_via_trace_clearance_error",
  )
  expect(viaTraceError).toMatchObject({
    type: "pcb_via_trace_clearance_error",
    error_type: "pcb_via_trace_clearance_error",
    pcb_via_id: "via_a",
    pcb_trace_id: "trace_a",
  })
  expect(errorsWithCenters).toHaveLength(1)
  expect(viaTraceError && "center" in viaTraceError).toBe(true)
  expect(locationAwareErrors).toHaveLength(1)
  expect(
    locationAwareErrors.some(
      (error) =>
        error.type === "pcb_via_trace_clearance_error" &&
        error.center.x === traceCenterX / 2 &&
        error.center.y === 0,
    ),
  ).toBe(true)
})
