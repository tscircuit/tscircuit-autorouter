import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { createBoundedRegionalRepairFixture } from "./pipeline9-bounded-regional-repair-fixture"

export const createFinalCopperRepairFixture = (): {
  srj: SimpleRouteJson
  trace: SimplifiedPcbTrace
} => {
  const { originalSrj: srj } = createBoundedRegionalRepairFixture()
  srj.minTraceWidth = 0.15
  const positions = [
    { x: 1.02, y: 0 },
    { x: -0.5, y: -1 },
  ]
  for (const [i, position] of positions.entries()) {
    srj.obstacles[i]!.center = position
    srj.connections[0]!.pointsToConnect[i] = {
      ...srj.connections[0]!.pointsToConnect[i]!,
      ...position,
    }
  }
  for (const obstacle of srj.obstacles) {
    obstacle.width = 0.54
    obstacle.height = 0.64
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "signal_0",
    connection_name: "signal",
    connectsTo: ["start", "end"],
    route: [
      {
        route_type: "wire",
        x: 1.02,
        y: 0,
        width: 0.15,
        layer: "top",
        start_pcb_port_id: "start",
      },
      { route_type: "wire", x: 0.9964, y: 0, width: 0.15, layer: "top" },
      { route_type: "wire", x: 0.5082, y: -0.4882, width: 0.15, layer: "top" },
      { route_type: "wire", x: 0.0118, y: -0.4882, width: 0.15, layer: "top" },
      { route_type: "wire", x: -0.1674, y: -0.6674, width: 0.15, layer: "top" },
      {
        route_type: "wire",
        x: -0.5,
        y: -1,
        width: 0.15,
        layer: "top",
        end_pcb_port_id: "end",
      },
    ],
  }
  srj.traces = [trace]
  return { srj, trace }
}
