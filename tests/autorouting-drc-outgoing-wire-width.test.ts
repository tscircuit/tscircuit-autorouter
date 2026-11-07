import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbTrace } from "circuit-json"
import { getFullConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"

test("clearance uses each wire's outgoing width at a narrow-to-wide transition", (): void => {
  const rail: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "rail",
    source_trace_id: "power",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.2 },
      { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.8 },
      { route_type: "wire", x: 4, y: 0, layer: "top", width: 0.8 },
    ],
  }
  const neighbor: PcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "neighbor",
    source_trace_id: "signal",
    route: [
      { route_type: "wire", x: 0.25, y: 0.35, layer: "top", width: 0.2 },
      { route_type: "wire", x: 0.75, y: 0.35, layer: "top", width: 0.2 },
    ],
  }
  const pad: AnyCircuitElement = {
    type: "pcb_smtpad",
    pcb_smtpad_id: "pad",
    shape: "rect",
    x: 1,
    y: -0.3,
    width: 0.2,
    height: 0.2,
    layer: "top",
  }
  const evaluate = (
    trace: PcbTrace,
  ): ReturnType<ReturnType<typeof createTraceObstacleClearanceEvaluator>> => {
    const circuitJson = [trace, neighbor, pad]
    return createTraceObstacleClearanceEvaluator([pad], {
      traceClearance: 0.1,
    })(circuitJson, getFullConnectivityMapFromCircuitJson(circuitJson))
  }
  expect(evaluate(rail)).toEqual({
    traceErrors: [],
    viaErrors: [],
    padErrors: [],
    holeErrors: [],
  })
  const widened = structuredClone(rail)
  const first = widened.route[0]!
  if (first.route_type !== "wire") throw new Error("Expected wire")
  first.width = 0.8
  const errors = evaluate(widened).traceErrors
  expect(errors).toHaveLength(2)
  expect(errors.map((e) => e.pcb_trace_error_id).sort()).toEqual([
    "overlap_rail_neighbor",
    "overlap_rail_pad",
  ])
})
