import type { SimpleRouteJson } from "lib/types"

export const createEnclosedTerminalFixture = (): SimpleRouteJson => ({
  bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
  layerCount: 4,
  minTraceWidth: 0.15,
  minTraceToPadEdgeClearance: 0.1,
  minViaDiameter: 0.45,
  connections: [
    {
      name: "signal",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "center_port" },
        { x: 2, y: 0, layer: "top", pcb_port_id: "outside_port" },
      ],
    },
  ],
  obstacles: [
    {
      type: "rect",
      layers: ["top"],
      center: { x: 0, y: 0 },
      width: 0.208,
      height: 0.208,
      connectedTo: ["center_pad", "center_port"],
    },
    ...[
      { x: -0.4, y: 0 },
      { x: 0.4, y: 0 },
      { x: 0, y: -0.4 },
      { x: 0, y: 0.4 },
    ].map((center, index) => ({
      type: "rect" as const,
      layers: ["top"],
      center,
      width: 0.208,
      height: 0.208,
      connectedTo: [`foreign_pad_${index}`],
    })),
  ],
})
