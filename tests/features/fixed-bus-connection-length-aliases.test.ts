import { expect, test } from "bun:test"
import { getFixedBusConnectionLengths } from "lib/solvers/getFixedBusConnectionLengths"
import type { SimplifiedPcbTrace } from "lib/types/srj-types"

test("fixed bus lengths resolve aliases and count replacement copper once", (): void => {
  const oldTrace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "old_escape",
    connection_name: "A_fanout",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 20, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const updatedTrace: SimplifiedPcbTrace = {
    ...oldTrace,
    pcb_trace_id: "updated_escape",
    __replaces_pcb_trace_id: oldTrace.pcb_trace_id,
    connection_name: "A_pin",
    connectsTo: ["A_pin", "A_fanout"],
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 2, layer: "top", width: 0.1 },
      { route_type: "via", x: 0, y: 2, from_layer: "top", to_layer: "bottom" },
      { route_type: "wire", x: 0, y: 2, layer: "bottom", width: 0.1 },
      { route_type: "through_obstacle", start: { x: 0, y: 2 }, end: { x: 3, y: 2 }, from_layer: "bottom", to_layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 3, y: 2, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 3, y: 6, layer: "bottom", width: 0.1 },
    ],
  }
  const unrelatedTrace = { ...oldTrace, pcb_trace_id: "unrelated", connection_name: "SUPPORT" }
  const traces = [oldTrace, updatedTrace, unrelatedTrace]
  const original = structuredClone(traces)
  const result = getFixedBusConnectionLengths({
    buses: [{ busId: "DDR_BYTE", connectionNames: ["A", "B"], maxLengthSkew: 0.1 }],
    connections: [
      { name: "A", netConnectionName: "A_net", pointsToConnect: [] },
      { name: "A_fanout", rootConnectionName: "A_net", pointsToConnect: [] },
      { name: "A_pin", mergedConnectionNames: ["A_fanout"], pointsToConnect: [] },
    ],
    traces,
  })
  expect(result).toEqual({ A: 9 })
  expect(traces).toEqual(original)
})
