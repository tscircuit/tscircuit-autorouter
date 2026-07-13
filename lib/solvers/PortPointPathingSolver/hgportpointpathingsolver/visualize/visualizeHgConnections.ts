import type { GraphicsObject } from "graphics-debug"
import type { ConnectionHg } from "../types"

/** Draws graph-level connection hints between source and target regions. */
export function visualizeHgConnections(
  connections: ConnectionHg[],
  colorMap: Record<string, string>,
): GraphicsObject {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
  }

  for (const connection of connections) {
    const startCenter = connection.startRegion.d.center
    const endCenter = connection.endRegion.d.center
    const midX = (startCenter.x + endCenter.x) / 2
    const midY = (startCenter.y + endCenter.y) / 2
    const connectionColor =
      colorMap[connection.connectionId] ?? "rgba(255, 50, 150, 0.8)"
    graphics.points!.push({
      x: midX,
      y: midY,
      color: connectionColor,
      label: connection.connectionId,
    })
    graphics.lines!.push({
      points: [startCenter, endCenter],
      strokeColor: "rgba(60, 60, 60, 0.18)",
      strokeWidth: 0.025,
      strokeDash: "0.15 0.15",
    })
  }
  return graphics
}
