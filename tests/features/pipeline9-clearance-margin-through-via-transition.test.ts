import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getPipeline9ClearanceMarginErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ClearanceMarginErrors"

test("clearance margin tracks an inner-layer transition inside a through via", (): void => {
  const circuitJson: AnyCircuitElement[] = [
    {
      type: "pcb_via",
      pcb_via_id: "via",
      pcb_trace_id: "owner",
      x: 0,
      y: 0,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "inner1", "inner2", "bottom"],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "owner",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "top",
          to_layer: "inner1",
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "inner1" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "signal",
      route: [
        { route_type: "wire", x: -1, y: 0.2995, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0.2995, width: 0.1, layer: "bottom" },
      ],
    },
  ]
  const measurement = getPipeline9ClearanceMarginErrors({
    circuitJson,
    originalCircuitJson: circuitJson,
    targets: [
      {
        type: "pcb_via_trace_clearance_error",
        pcb_via_id: "via",
        pcb_trace_id: "signal",
        minimum_clearance: 0.1,
        actual_clearance: 0.0995,
      },
    ],
  })
  expect(measurement.status).toBe("measured")
  if (measurement.status !== "measured") {
    throw new Error(
      "Expected the through-via transition to retain its identity",
    )
  }
  expect(measurement.errors).toHaveLength(1)
  expect(measurement.errors[0]!.actual_clearance).toBeCloseTo(0.0995, 10)
  expect(measurement.errors[0]!.pcb_via_id).toBe("via")
})
