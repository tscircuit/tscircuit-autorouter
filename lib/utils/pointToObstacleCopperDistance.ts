import type { Obstacle } from "../types"

/** Euclidean distance to the actual rotated rectangle or pill copper. */
export function pointToObstacleCopperDistance(
  point: { x: number; y: number }, obstacle: Obstacle,
): number {
  const geometry = obstacle.copperGeometry ?? obstacle
  const { width, height, center } = geometry
  const rotation = geometry.ccwRotationDegrees ?? 0
  if (![point.x, point.y, center.x, center.y, width, height, rotation].every(Number.isFinite) ||
      width <= 0 || height <= 0) return Infinity
  const radians = rotation * Math.PI / 180
  const dx = point.x - center.x, dy = point.y - center.y
  const x = dx * Math.cos(radians) + dy * Math.sin(radians)
  const y = -dx * Math.sin(radians) + dy * Math.cos(radians)
  if (String(geometry.type) !== "oval" && geometry.shape !== "circle") {
    return Math.hypot(Math.max(0, Math.abs(x) - width / 2), Math.max(0, Math.abs(y) - height / 2))
  }
  const radius = Math.min(width, height) / 2
  const halfLine = Math.abs(width - height) / 2
  const axis = width >= height ? x : y
  const perpendicular = width >= height ? y : x
  return Math.max(0, Math.hypot(Math.max(0, Math.abs(axis) - halfLine), perpendicular) - radius)
}
