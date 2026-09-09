import type { SimpleRouteJson } from "lib/types"

export const createPipeline9PadAreaTerminalInput = (
  rotationDegrees: number = 0,
  translation: { x: number; y: number } = { x: 0, y: 0 },
): SimpleRouteJson => {
  const angle = (rotationDegrees * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const transformPoint = (x: number, y: number): { x: number; y: number } => {
    const rotatedX = x * cos - y * sin
    const rotatedY = x * sin + y * cos
    return {
      x: translation.x + rotatedX,
      y: translation.y + rotatedY,
    }
  }
  return {
    layerCount: 2,
    minTraceWidth: 0.25,
    minTraceToPadEdgeClearance: 0.1,
    bounds: { minX: -8, maxX: 8, minY: -8, maxY: 8 },
    obstacles: [
      {
        obstacleId: "own-pad",
        type: "rect",
        center: transformPoint(0, 0),
        width: 2,
        height: 2,
        ccwRotationDegrees: rotationDegrees,
        layers: ["top"],
        connectedTo: ["pcb-a"],
      },
      {
        obstacleId: "foreign-pad",
        type: "rect",
        center: transformPoint(1.125, 0),
        width: 0.25,
        height: 2,
        ccwRotationDegrees: rotationDegrees,
        layers: ["top"],
        connectedTo: ["foreign-net"],
      },
    ],
    connections: [
      {
        name: "net-a",
        nominalTraceWidth: 0.25,
        pointsToConnect: [
          {
            ...transformPoint(0.875, 0),
            layer: "top",
            pcb_port_id: "pcb-a",
            pointId: "logical-a",
          },
          {
            ...transformPoint(-2, 0),
            layer: "top",
            pcb_port_id: "pcb-b",
            pointId: "logical-b",
          },
        ],
      },
    ],
  }
}
