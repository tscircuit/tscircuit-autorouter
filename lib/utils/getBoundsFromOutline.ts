export type Bounds = { minX: number; minY: number; maxX: number; maxY: number }

/**
 * Compute an axis-aligned bounding box from a board outline polygon.
 * Accepts any outline with >= 1 point; for routing heuristics this is sufficient.
 */
export function getBoundsFromOutline(
  outline: Array<{ x: number; y: number }>,
): Bounds {
  if (!outline || outline.length === 0) {
    throw new Error("Outline must contain at least one point")
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const p of outline) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }

  return { minX, minY, maxX, maxY }
}
