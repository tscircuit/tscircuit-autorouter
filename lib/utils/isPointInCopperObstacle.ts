import type { Obstacle } from "lib/types"
import { getSegmentToObstacleDistance } from "./getSegmentToObstacleDistance"

const COPPER_CONTACT_TOLERANCE = 1e-6

export function isPointInCopperObstacle(
  obstacle: Obstacle,
  point: { x: number; y: number },
): boolean {
  if (obstacle.shape === "circle") {
    return (
      Math.hypot(point.x - obstacle.center.x, point.y - obstacle.center.y) <=
      obstacle.width / 2 + COPPER_CONTACT_TOLERANCE
    )
  }
  if ((obstacle.type as string) === "oval") {
    const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const dx = point.x - obstacle.center.x
    const dy = point.y - obstacle.center.y
    const x = dx * Math.cos(angle) + dy * Math.sin(angle)
    const y = dy * Math.cos(angle) - dx * Math.sin(angle)
    return (
      Math.hypot(
        x / (obstacle.width / 2 + COPPER_CONTACT_TOLERANCE),
        y / (obstacle.height / 2 + COPPER_CONTACT_TOLERANCE),
      ) <= 1
    )
  }
  return (
    getSegmentToObstacleDistance({ start: point, end: point, obstacle }) <=
    COPPER_CONTACT_TOLERANCE
  )
}
