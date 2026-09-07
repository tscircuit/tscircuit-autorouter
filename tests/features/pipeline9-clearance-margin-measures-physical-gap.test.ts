import { checkViaTraceClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { getPipeline9ClearanceMarginErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ClearanceMarginErrors"

test("clearance margin measures the copper gap beyond checker tolerance", (): void => {
  for (const gap of [0.0995, 0.1095, 0.11, 0.1101, 0.12]) {
    const traceY = 0.15 + 0.05 + gap
    const circuitJson: AnyCircuitElement[] = [
      {
        type: "pcb_via",
        pcb_via_id: "via",
        pcb_trace_id: "via_owner",
        x: 0,
        y: 0,
        outer_diameter: 0.3,
        hole_diameter: 0.15,
        layers: ["top", "bottom"],
      },
      {
        type: "pcb_trace",
        pcb_trace_id: "via_owner",
        route: [
          { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
          { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
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
          { route_type: "wire", x: -1, y: traceY, width: 0.1, layer: "top" },
          { route_type: "wire", x: 1, y: traceY, width: 0.1, layer: "top" },
        ],
      },
    ]
    expect(
      checkViaTraceClearance(circuitJson, { minClearance: 0.1 }),
    ).toHaveLength(0)
    const measured = checkViaTraceClearance(circuitJson, {
      minClearance: 0.2,
    })
    expect(measured).toHaveLength(1)
    expect(measured[0]!.actual_clearance).toBeCloseTo(gap, 10)
    const errors = getPipeline9ClearanceMarginErrors({
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
    })
    expect(errors).toHaveLength(gap < 0.11 ? 1 : 0)
    if (gap < 0.11) {
      expect(errors[0]!.actual_clearance).toBeCloseTo(gap, 10)
      expect(errors[0]!.minimum_clearance).toBeCloseTo(0.11, 10)
    }
  }
})
