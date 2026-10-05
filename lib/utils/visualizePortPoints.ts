import type { GraphicsObject } from "graphics-debug"

export interface VisualizablePortPoint {
  id: string
  x: number
  y: number
  /** Single z value or array of z values */
  z: number | number[]
  /** Connection name if assigned, null/undefined if unassigned */
  connectionName?: string | null
}

export interface VisualizePortPointsOptions {
  /** Radius for port point circles */
  radius: number
  /** Color map for assigned connections */
  colorMap: Record<string, string>
  /** Color for unassigned port points */
  unassignedColor?: string
  /** Whether to include z values in the label */
  includeZInLabel?: boolean
}

/**
 * Adds port point visualizations to a graphics object.
 *
 * @param graphics - The graphics object to add circles to
 * @param portPoints - Array of port points to visualize
 * @param options - Visualization options
 */
export function visualizePortPoints(
  graphics: GraphicsObject,
  portPoints: VisualizablePortPoint[],
  options: VisualizePortPointsOptions,
): void {
  const {
    radius,
    colorMap,
    unassignedColor = "rgba(150, 150, 150, 0.5)",
    includeZInLabel = false,
  } = options

  if (!graphics.circles) {
    graphics.circles = []
  }

  for (const portPoint of portPoints) {
    const isAssigned =
      portPoint.connectionName !== null &&
      portPoint.connectionName !== undefined
    const color = isAssigned
      ? (colorMap[portPoint.connectionName!] ?? "blue")
      : unassignedColor

    const zValue = Array.isArray(portPoint.z)
      ? portPoint.z.join(",")
      : String(portPoint.z)

    let label: string
    if (isAssigned) {
      label = includeZInLabel
        ? `${portPoint.id}\n${portPoint.connectionName}\n${zValue}`
        : `${portPoint.id}\n${portPoint.connectionName}`
    } else {
      label = includeZInLabel ? `${portPoint.id}\n${zValue}` : portPoint.id
    }

    graphics.circles.push({
      center: { x: portPoint.x, y: portPoint.y },
      radius,
      fill: color,
      layer: `z${zValue}`,
      label,
    })
  }
}
