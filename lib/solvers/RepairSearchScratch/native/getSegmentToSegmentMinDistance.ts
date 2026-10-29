import { doSegmentsIntersect } from "@tscircuit/math-utils"

type Point = { x: number; y: number }

const getPointToSegmentSquaredDistance = (
  p: Point,
  a: Point,
  b: Point,
): number => {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const lengthSquared = vx ** 2 + vy ** 2
  if (lengthSquared === 0) {
    const dx = p.x - a.x
    const dy = p.y - a.y
    return dx * dx + dy * dy
  }
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSquared),
  )
  const dx = p.x - (a.x + t * vx)
  const dy = p.y - (a.y + t * vy)
  return dx * dx + dy * dy
}

/** Preserve the distance calculation while taking only the winning square root. */
export const getSegmentToSegmentMinDistance = (
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): number => {
  if (a.x === b.x && a.y === b.y) {
    return Math.sqrt(getPointToSegmentSquaredDistance(a, c, d))
  }
  if (c.x === d.x && c.y === d.y) {
    return Math.sqrt(getPointToSegmentSquaredDistance(c, a, b))
  }
  if (doSegmentsIntersect(a, b, c, d)) return 0
  return Math.sqrt(
    Math.min(
      getPointToSegmentSquaredDistance(a, c, d),
      getPointToSegmentSquaredDistance(b, c, d),
      getPointToSegmentSquaredDistance(c, a, b),
      getPointToSegmentSquaredDistance(d, a, b),
    ),
  )
}
