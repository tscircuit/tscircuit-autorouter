import type { Bounds } from "./repairRegionTypes"

type Point = { x: number; y: number }

/** Tighten only inside the previous enclosure, with outward rounding slack. */
export const getConservativeRectBarrierBounds = (
  a: Point,
  b: Point,
  rect: { width: number; height: number; rotation: number },
  cosine: number,
  sine: number,
  original: Bounds,
): Bounds => {
  if (
    a.x !== b.x ||
    a.y !== b.y ||
    !Number.isFinite(rect.rotation) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    ![
      a.x,
      a.y,
      rect.width,
      rect.height,
      original.minX,
      original.maxX,
      original.minY,
      original.maxY,
    ].every((value) => Number.isFinite(value) && Math.abs(value) <= 10_000)
  )
    return original

  // The exact checker transforms world coordinates with these same computed
  // cosine/sine values. Divide by their determinant to enclose the inverse
  // transform, rather than assuming floating-point cos² + sin² is exactly 1.
  const determinant = cosine * cosine + sine * sine
  if (!Number.isFinite(determinant) || Math.abs(determinant - 1) > 1e-12)
    return original
  const outwardMargin = 1e-8
  const halfWidth = rect.width / 2,
    halfHeight = rect.height / 2
  const extentX =
    (Math.abs(cosine) * halfWidth + Math.abs(sine) * halfHeight) / determinant +
    outwardMargin
  const extentY =
    (Math.abs(sine) * halfWidth + Math.abs(cosine) * halfHeight) / determinant +
    outwardMargin
  const bounds = {
    minX: a.x - extentX,
    maxX: a.x + extentX,
    minY: a.y - extentY,
    maxY: a.y + extentY,
  }
  // Never enlarge the original query domain. Degenerate/equal-boundary cases
  // retain the original bounds and exact checker behavior.
  if (
    bounds.minX < original.minX ||
    bounds.maxX > original.maxX ||
    bounds.minY < original.minY ||
    bounds.maxY > original.maxY
  )
    return original
  return bounds
}
