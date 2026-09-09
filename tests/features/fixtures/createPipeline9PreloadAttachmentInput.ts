import type { SimpleRouteJson } from "lib/types"

export const createPipeline9PreloadAttachmentInput = (): SimpleRouteJson => {
  return {
    layerCount: 2,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -4, maxX: 4, minY: -2, maxY: 3 },
    obstacles: [
      {
        obstacleId: "terminal-pad",
        type: "rect",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: ["port-a", "port-b", "port-c", "port-d"],
      },
    ],
    connections: [
      {
        name: "new-pair-a-c",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pcb_port_id: "port-a",
            pointId: "logical-a",
          },
          { x: 3, y: 0, layer: "top", pcb_port_id: "port-c" },
        ],
      },
      {
        name: "new-pair-a-d",
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pcb_port_id: "port-a",
            pointId: "logical-a",
          },
          { x: 3, y: 2, layer: "top", pcb_port_id: "port-d" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "established-a-b-copper",
        connection_name: "old-pair-a-b",
        connectsTo: ["port-b", "port-a"],
        route: [
          {
            route_type: "wire",
            x: 0.2,
            y: 0.2,
            layer: "top",
            width: 0.1,
            start_pcb_port_id: "port-a",
          },
          {
            route_type: "wire",
            x: -3,
            y: 0.2,
            layer: "top",
            width: 0.1,
            end_pcb_port_id: "port-b",
          },
        ],
      },
    ],
  }
}
