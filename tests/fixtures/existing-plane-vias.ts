import type { SimpleRouteJson } from "lib/types"

// Same handoff as the USB-C motor motherboard: inner3 endpoints at existing
// through-via centers. connectedTo identifies physical points, not the net name.
export const existingPlaneVias: SimpleRouteJson = {
  layerCount: 6,
  minTraceWidth: 0.15,
  minViaPadDiameter: 0.3,
  minViaHoleDiameter: 0.15,
  bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
  connections: [
    {
      name: "GND",
      pointsToConnect: [
        { x: -1, y: 0, layer: "inner3", pointId: "A" },
        { x: 1, y: 0, layer: "inner3", pointId: "B" },
      ],
    },
  ],
  obstacles: [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 6,
      height: 4,
      layers: ["inner1"],
      connectedTo: ["GND"],
      isCopperPour: true,
    },
    {
      type: "rect",
      shape: "circle",
      center: { x: -1, y: 0 },
      width: 0.3,
      height: 0.3,
      layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
      connectedTo: ["A"],
    },
    {
      type: "rect",
      shape: "circle",
      center: { x: 1, y: 0 },
      width: 0.3,
      height: 0.3,
      layers: ["top", "inner1", "inner2", "inner3", "inner4", "bottom"],
      connectedTo: ["B"],
    },
  ],
}
