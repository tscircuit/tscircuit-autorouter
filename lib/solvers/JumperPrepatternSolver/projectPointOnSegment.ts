import { Point2D } from "./JumperPrepatternSolver2_HyperGraph"

/**
 * Project a point onto a line segment and return the parameter t (0-1 means on segment)
 */

export function projectPointOnSegment(
  p: Point2D,
  a: Point2D,
  b: Point2D,
): { t: number; point: Point2D } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy

  if (lenSq < 1e-12) {
    return { t: 0, point: { x: a.x, y: a.y } }
  }

  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq),
  )
  return {
    t,
    point: { x: a.x + t * dx, y: a.y + t * dy },
  }
}
