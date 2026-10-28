import type { Obstacle } from "lib/types/srj-types"

/** Signed distance to declared copper, with conservative bounds for ambiguous legacy ovals. */
export const getPipeline9PadPointDistance = (
  point: { x: number; y: number },
  obstacle: Obstacle,
  ovalBound: "inner" | "outer",
): number => {
  const dx = point.x - obstacle.center.x
  const dy = point.y - obstacle.center.y
  const legacyType: string = obstacle.type
  if (obstacle.shape === "circle" ||
    (legacyType === "oval" && obstacle.width === obstacle.height)) {
    return Math.hypot(dx, dy) - obstacle.width / 2
  }
  if (legacyType !== "rect" && ovalBound === "inner") {
    // Both an ellipse and a stadium contain this central disk. Unknown
    // non-oval shapes supply no positive copper certificate.
    return legacyType === "oval"
      ? Math.hypot(dx, dy) - Math.min(obstacle.width, obstacle.height) / 2
      : Number.POSITIVE_INFINITY
  }
  const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
  const outsideX = Math.abs(localX) - obstacle.width / 2
  const outsideY = Math.abs(localY) - obstacle.height / 2
  return Math.hypot(Math.max(outsideX, 0), Math.max(outsideY, 0)) +
    Math.min(Math.max(outsideX, outsideY), 0)
}
