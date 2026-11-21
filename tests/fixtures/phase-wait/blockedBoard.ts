import type { SimpleRouteJson } from "lib/types"

export const blockedBoard: SimpleRouteJson = {
  layerCount: 6,
  minTraceWidth: 0.1,
  bounds: { minX: -8, maxX: 8, minY: -2, maxY: 2 },
  obstacles: [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 3,
      height: 10,
      layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "signal",
      pointsToConnect: [
        { x: -5, y: 0, layer: "top" },
        { x: 5, y: 0, layer: "top" },
      ],
    },
  ],
}
