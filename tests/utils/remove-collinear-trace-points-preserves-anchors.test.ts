import { expect, test } from "bun:test"
import type { SimplifiedPcbTrace } from "lib/types"
import { removeCollinearTracePoints } from "lib/utils/removeCollinearTracePoints"

test("collinear cleanup preserves electrical anchors and width changes", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace",
    connection_name: "net",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      {
        route_type: "wire",
        x: 1,
        y: 0,
        layer: "top",
        width: 0.1,
        end_pcb_port_id: "pad",
      },
      { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
      { route_type: "via", x: 2, y: 0, from_layer: "top", to_layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 3, y: 0, layer: "bottom", width: 0.1 },
      {
        route_type: "jumper",
        start: { x: 3, y: 0 },
        end: { x: 4, y: 0 },
        layer: "bottom",
        footprint: "0603",
      },
      { route_type: "wire", x: 4, y: 0, layer: "bottom", width: 0.1 },
      { route_type: "wire", x: 5, y: 0, layer: "bottom", width: 0.2 },
      { route_type: "wire", x: 6, y: 0, layer: "bottom", width: 0.2 },
      {
        route_type: "through_obstacle",
        start: { x: 6, y: 0 },
        end: { x: 7, y: 0 },
        from_layer: "bottom",
        to_layer: "bottom",
        width: 0.2,
      },
      { route_type: "wire", x: 7, y: 0, layer: "bottom", width: 0.2 },
      { route_type: "wire", x: 8, y: 0, layer: "bottom", width: 0.2 },
    ],
  }
  expect(removeCollinearTracePoints(trace)).toEqual(trace)
})
