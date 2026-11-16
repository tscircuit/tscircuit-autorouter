import type { Obstacle } from "lib/types"

/**
 * Point and obstacle positions use right-handed board-world millimeters:
 * +X right, +Y up, +Z above the board. No coordinate transform is applied.
 */
export function getPointToObstacleDistance(
  point: { x: number; y: number },
  obstacle: Obstacle,
): number {
  if (obstacle.shape === "circle") {
    return Math.max(
      0,
      Math.hypot(point.x - obstacle.center.x, point.y - obstacle.center.y) -
        obstacle.width / 2,
    )
  }
  const rotationRadians =
    (-1 * (obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const offsetX = point.x - obstacle.center.x
  const offsetY = point.y - obstacle.center.y
  const localX =
    offsetX * Math.cos(rotationRadians) - offsetY * Math.sin(rotationRadians)
  const localY =
    offsetX * Math.sin(rotationRadians) + offsetY * Math.cos(rotationRadians)
  const outsideX = Math.max(Math.abs(localX) - obstacle.width / 2, 0)
  const outsideY = Math.max(Math.abs(localY) - obstacle.height / 2, 0)
  return Math.hypot(outsideX, outsideY)
}
