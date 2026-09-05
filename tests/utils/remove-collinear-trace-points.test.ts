import { expect, test } from "bun:test"
import type { SimplifiedPcbTrace } from "lib/types"
import { removeCollinearTracePoints } from "lib/utils/removeCollinearTracePoints"

test("collinear cleanup removes retraced burrs without mutating the trace", () => {
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace",
    connection_name: "net",
    route: [
      { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 1, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: 2, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: 2, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: 0, y: 1, layer: "top", width: 0.1 },
      { route_type: "wire", x: -1, y: 2, layer: "top", width: 0.1 },
    ],
  }
  expect(removeCollinearTracePoints(trace)).toEqual({
    ...trace,
    route: [trace.route[0], trace.route[1], trace.route[4], trace.route[5]],
  })
  expect(trace.route).toHaveLength(6)
})
