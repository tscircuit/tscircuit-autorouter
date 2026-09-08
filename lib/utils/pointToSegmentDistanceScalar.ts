import { distance } from "@tscircuit/math-utils"

type Point = { x: number; y: number }

/** Preserve math-utils arithmetic and read order without allocating a projection. */
export function pointToSegmentDistanceScalar(p: Point, v: Point, w: Point): number {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2
  if (l2 === 0) return distance(p, v)

  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  t = Math.max(0, Math.min(1, t))

  // Read both projection coordinates before reading p, as the original does.
  // Keep live endpoint reads: public query segments can be replaced or mutated.
  const projectionX = v.x + t * (w.x - v.x)
  const projectionY = v.y + t * (w.y - v.y)
  const dx = p.x - projectionX
  const dy = p.y - projectionY
  return Math.sqrt(dx * dx + dy * dy)
}
