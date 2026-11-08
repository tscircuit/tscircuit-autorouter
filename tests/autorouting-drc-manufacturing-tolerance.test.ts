import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"

test("manufacturing clearance permits only one micrometer of numeric rounding", (): void => {
  for (const gap of [0.0975, 0.0995, 0.1001]) {
    for (const kind of ["pad", "via", "trace"] as const) {
      const circuit: AnyCircuitElement[] = [
        {
          type: "pcb_trace",
          pcb_trace_id: "wire",
          source_trace_id: "signal",
          route: [-1, 1].map((x) => ({
            route_type: "wire",
            x,
            y: 0,
            width: 0.1,
            layer: "top",
          })),
        },
      ]
      if (kind === "pad")
        circuit.push({
          type: "pcb_smtpad",
          pcb_smtpad_id: "other",
          shape: "rect",
          layer: "top",
          x: 0,
          y: 0.5 + 0.05 + gap,
          width: 0.5,
          height: 1,
        })
      else if (kind === "via")
        circuit.push({
          type: "pcb_via",
          pcb_via_id: "other",
          x: 0,
          y: 0.3 + 0.05 + gap,
          outer_diameter: 0.6,
          hole_diameter: 0.3,
          layers: ["top", "bottom"],
        })
      else
        circuit.push({
          type: "pcb_trace",
          pcb_trace_id: "other",
          source_trace_id: "foreign",
          route: [-1, 1].map((x) => ({
            route_type: "wire",
            x,
            y: 0.1 + gap,
            width: 0.1,
            layer: "top",
          })),
        })
      const connectivity = new ConnectivityMap({})
      connectivity.addConnections([
        ["wire", "signal"],
        ["other", "foreign"],
      ])
      const evaluate = createTraceObstacleClearanceEvaluator(circuit, {
        traceClearance: 0.1,
      })
      const errors = Object.values(evaluate(circuit, connectivity)).flat()
      expect(errors.length > 0).toBe(gap < 0.099)
    }
  }
})
