import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

export const snapshotInput: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  obstacles: [],
  connections: [],
  traces: [
    {
      type: "pcb_trace",
      pcb_trace_id: "existing",
      connection_name: "existing",
      route: [
        { route_type: "wire", x: -1, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 1, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ],
}

export const crossingTrace: SimplifiedPcbTrace = {
  type: "pcb_trace",
  pcb_trace_id: "new",
  connection_name: "new",
  route: [
    { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
    { route_type: "wire", x: 0, y: 1, width: 0.1, layer: "top" },
  ],
}
