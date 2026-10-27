import type { SimpleRouteJson } from "lib/types"

export const krtTestBoard = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: -2, maxX: 4, minY: -2, maxY: 3 },
  outline: [
    { x: -1, y: -1 },
    { x: 3, y: -1 },
    { x: 3, y: 1 },
    { x: -1, y: 1 },
  ],
  obstacles: [],
  connections: [
    {
      name: "tree",
      __rootConnectionNames: ["original_net"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "a" },
        { x: 2, y: 0, layer: "top", pcb_port_id: "b" },
        { x: 1, y: 0.5, layer: "top", pcb_port_id: "c" },
      ],
    },
  ],
})
