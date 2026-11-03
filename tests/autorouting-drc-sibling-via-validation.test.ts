import { expect, test } from "bun:test"
import { checkTracesAreContiguous } from "@tscircuit/checks"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"

test("continuity still validates sibling vias after the net's ports are connected", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [0, 4].map((x) => ({
      type: "rect",
      center: { x, y: 0 },
      width: 0.6,
      height: 0.6,
      layers: ["top"],
      connectedTo: [`pcb_port_${x}`, "net"],
    })),
    connections: [{
      name: "net",
      pointsToConnect: [0, 4].map((x) => ({
        x, y: 0, layer: "top", pcb_port_id: `pcb_port_${x}`,
      })),
    }],
  }
  const connected: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "connected",
    connection_name: "net",
    route: [0, 4].map((x) => ({
      route_type: "wire", x, y: 0, width: 0.1, layer: "top",
    })),
  }
  const sibling: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "misaligned_sibling",
    connection_name: "net",
    route: [
      { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      { route_type: "via", x: 2, y: 0, from_layer: "top", to_layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "inner1" },
    ],
  }
  const circuit = convertToCircuitJson(srj, [connected, sibling])
  const before = structuredClone(circuit)
  const errors = checkTraceContinuity(circuit)
  expect<unknown>(errors).toEqual(checkTracesAreContiguous(circuit))
  expect(errors).toHaveLength(1)
  expect(errors[0]?.pcb_trace_id).toBe("misaligned_sibling")
  expect(String(errors[0]?.pcb_trace_error_id)).toStartWith("misaligned_via_")
  expect(circuit).toEqual(before)
})
