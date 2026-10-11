import type { Obstacle } from "../types"

/** Tests actual rect or pill copper, including rotation, rather than its AABB. */
export function pointInsideObstacleCopper(
  point: { x: number; y: number }, obstacle: Obstacle, tolerance = 1e-6,
): boolean {
  const geometry = obstacle.copperGeometry ?? obstacle
  const { width, height, center } = geometry
  if (![point.x, point.y, center.x, center.y, width, height, tolerance].every(Number.isFinite) ||
      width <= 0 || height <= 0 || tolerance < 0) return false
  const rotation = geometry.ccwRotationDegrees ?? 0
  if (!Number.isFinite(rotation)) return false
  const radians = rotation * Math.PI / 180
  const dx = point.x - center.x, dy = point.y - center.y
  const x = dx * Math.cos(radians) + dy * Math.sin(radians)
  const y = -dx * Math.sin(radians) + dy * Math.cos(radians)
  // SRJ18 includes pill obstacles although the legacy public type names rect only.
  if (String(geometry.type) !== "oval" && geometry.shape !== "circle") {
    return Math.abs(x) <= width / 2 + tolerance && Math.abs(y) <= height / 2 + tolerance
  }
  const radius = Math.min(width, height) / 2
  const halfLine = Math.abs(width - height) / 2
  const axis = width >= height ? x : y
  const perpendicular = width >= height ? y : x
  const beyondLine = Math.max(0, Math.abs(axis) - halfLine)
  return beyondLine ** 2 + perpendicular ** 2 <= (radius + tolerance) ** 2
}
