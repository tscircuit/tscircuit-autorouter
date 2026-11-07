import type { SimpleRouteJson } from "lib/types"

// Based on the existing narrow-channel repro (#2606).
export const getConnectionMinimumTraceWidthInput = (): SimpleRouteJson => ({
  bounds: { minX: -15, maxX: 15, minY: -10, maxY: 10 },
  layerCount: 1,
  minTraceWidth: 0.1,
  minTraceToPadEdgeClearance: 0.13,
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: -11.4, y: 0 },
      width: 0.8,
      height: 0.8,
      connectedTo: ["WIDE_POWER"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 11.4, y: 0 },
      width: 0.8,
      height: 0.8,
      connectedTo: ["WIDE_POWER"],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: 1.425 },
      width: 20,
      height: 2.35,
      connectedTo: [],
    },
    {
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: -1.425 },
      width: 20,
      height: 2.35,
      connectedTo: [],
    },
  ],
  connections: [
    {
      name: "WIDE_POWER",
      nominalTraceWidth: 0.4,
      minTraceWidth: 0.4,
      pointsToConnect: [
        { x: -11.4, y: 0, layer: "top", pointId: "left" },
        { x: 11.4, y: 0, layer: "top", pointId: "right" },
      ],
    },
  ],
})
