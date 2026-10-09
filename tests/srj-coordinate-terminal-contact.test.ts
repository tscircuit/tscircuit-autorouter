import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("native coordinate terminals require same-layer contact in one physical copper component", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 4, allowBlindAndBuriedVias: false, minTraceWidth: 0.1,
    minViaPadDiameter: 0.3, minViaHoleDiameter: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, obstacles: [],
    connections: [{ name: "DATA", pointsToConnect: [{ x: -3, y: 0, layer: "top" }, { x: 3, y: 0, layer: "top" }] }],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace", pcb_trace_id: "data", connection_name: "DATA",
    route: [
      { route_type: "wire", x: -3, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const original = JSON.stringify(input)
  const evaluate = (traces: SimplifiedPcbTrace[]): ReturnType<typeof evaluateRelaxedDrc> => {
    return evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: input,
      routedTraces: traces,
    })
  }
  const accepted = evaluate([trace])
  expect(accepted.errors).toEqual([])
  expect(accepted.circuitJson.filter(element => ["pcb_smtpad", "pcb_plated_hole", "pcb_via"].includes(element.type))).toEqual([])
  const moved = structuredClone(trace)
  moved.route[0] = { route_type: "wire", x: -2.8, y: 0, layer: "top", width: 0.1 }
  expect(evaluate([moved]).errors.some(error => "pcb_trace_error_id" in error && error.pcb_trace_error_id.startsWith("srj_coordinate_terminal_"))).toBe(true)
  const wrongLayer = structuredClone(trace)
  for (const point of wrongLayer.route) if (point.route_type === "wire") point.layer = "bottom"
  expect(evaluate([wrongLayer]).errors).not.toEqual([])
  const first = structuredClone(trace), second = structuredClone(trace)
  first.route[1] = { route_type: "wire", x: -1, y: 0, layer: "top", width: 0.1 }
  second.pcb_trace_id = "data_other_island"
  second.route[0] = { route_type: "wire", x: 1, y: 0, layer: "top", width: 0.1 }
  expect(evaluate([first, second]).errors.some(error => String(error.message).includes("disconnected copper components"))).toBe(true)
  input.connections[0]!.pointsToConnect.push({ x: 3, y: 2, layer: "top" })
  expect(evaluate([trace]).errors.some(error => String(error.message).includes("misses native SRJ coordinate terminal"))).toBe(true)
  input.connections[0]!.pointsToConnect.pop()
  expect(JSON.stringify(input)).toBe(original)
})
