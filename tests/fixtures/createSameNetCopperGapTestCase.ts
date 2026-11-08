import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

export const createSameNetCopperGapTestCase = (): {
  srj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
} => {
  const traces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "left",
      connection_name: "GND",
      route: [
        { route_type: "wire", x: -0.5, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      ],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "right",
      connection_name: "GND",
      route: [
        { route_type: "wire", x: 0.15, y: 0, width: 0.1, layer: "top" },
        { route_type: "wire", x: 0.65, y: 0, width: 0.1, layer: "top" },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    obstacles: [],
    connections: [
      {
        name: "GND",
        pointsToConnect: [
          { x: -0.5, y: 0, layer: "top" },
          { x: 0.65, y: 0, layer: "top" },
        ],
      },
    ],
  }
  return { srj, traces }
}
