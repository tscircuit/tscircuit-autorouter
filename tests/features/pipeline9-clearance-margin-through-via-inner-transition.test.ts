import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getPipeline9ClearanceMarginErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ClearanceMarginErrors"

test("clearance margin tracks an inner-layer transition inside a through-hole drill span", (): void => {
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
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "inner1" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner1" },
        {
          route_type: "via",
          x: 0,
          y: 0,
          from_layer: "inner1",
          to_layer: "bottom",
        },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "bottom" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "bottom" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "signal",
      route: [
        { route_type: "wire", x: -1, y: 0.289, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0.289, width: 0.1, layer: "top" },
      ],
    },
  ]
  const input: Parameters<typeof getPipeline9ClearanceMarginErrors>[0] = {
    circuitJson,
    originalCircuitJson: circuitJson,
    targets: [
      {
        type: "pcb_via_trace_clearance_error",
        pcb_via_id: "via",
        pcb_trace_id: "signal",
        actual_clearance: 0.089,
        minimum_clearance: 0.1,
      },
    ],
  }
  const measurement = getPipeline9ClearanceMarginErrors(input)
  expect(measurement.status).toBe("measured")
  if (measurement.status !== "measured") {
    throw new Error("Expected the through-hole via's route transition to match")
  }
  expect(measurement.errors).toHaveLength(1)
  expect(measurement.errors[0]!.actual_clearance).toBeCloseTo(0.089, 10)

  const owner = circuitJson.find((element) => element.type === "pcb_trace")!
  owner.route.push({
    route_type: "via",
    x: 0,
    y: 0,
    from_layer: "bottom",
    to_layer: "inner1",
  })
  expect(getPipeline9ClearanceMarginErrors(input)).toEqual({
    status: "unsupported-identity",
  })
  owner.route = owner.route.filter((segment) => segment.route_type !== "via")
  expect(() => getPipeline9ClearanceMarginErrors(input)).toThrow(
    "Pipeline9 clearance margin lost the original via transition",
  )
})
