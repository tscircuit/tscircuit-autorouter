import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("repair reference DRC preserves explicit SRJ via-in-pad permission", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    allowViaInPad: true,
    bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
    connections: [{
      name: "signal",
      pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "pad_port" }, { x: 1, y: 0, layer: "bottom", pcb_port_id: "end_port" }],
    }],
    obstacles: [{
      type: "rect", center: { x: 0, y: 0 }, width: 0.8, height: 0.8,
      layers: ["top"], connectedTo: ["pad_port", "signal"],
      circuitJsonMetadata: { pcb_smtpad_id: "pad", pcb_port_id: "pad_port" },
    }],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace", pcb_trace_id: "signal_0", connection_name: "signal",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.15, start_pcb_port_id: "pad_port" },
      { route_type: "via", x: 0, y: 0, from_layer: "top", to_layer: "bottom", via_diameter: 0.3, via_hole_diameter: 0.2 },
      { route_type: "wire", x: 0, y: 0, layer: "bottom", width: 0.15 },
      { route_type: "wire", x: 1, y: 0, layer: "bottom", width: 0.15, end_pcb_port_id: "end_port" },
    ],
  }
  const allowed = evaluateRelaxedDrc({ inputSrj: srj, srjWithPointPairs: srj, routedTraces: [trace] })
  expect(allowed.errors).toEqual([])
  const forbiddenSrj = { ...srj, allowViaInPad: false }
  const forbidden = evaluateRelaxedDrc({ inputSrj: forbiddenSrj, srjWithPointPairs: forbiddenSrj, routedTraces: [trace] })
  expect(forbidden.errors).toHaveLength(1)
  expect(forbidden.errors[0]?.type).toBe("pcb_pad_pad_clearance_error")
})
