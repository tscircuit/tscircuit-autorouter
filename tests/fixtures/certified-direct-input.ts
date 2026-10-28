import type { SimpleRouteJson } from "lib/types"

export const getCertifiedDirectTestInput = (): SimpleRouteJson => {
  return {
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    layerCount: 2, minTraceWidth: 0.2, defaultObstacleMargin: 0.1,
    obstacles: [],
    connections: [{ name: "signal", pointsToConnect: [
      { x: -1, y: 0, layer: "top", pcb_port_id: "a" },
      { x: 1, y: 0, layer: "top", pcb_port_id: "b" },
    ] }],
  }
}
