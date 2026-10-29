import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { ViaPlacement } from "lib/types/high-density-types"

type BoardEdge = {
  x: number
  y: number
  dx: number
  dy: number
  lengthSquared: number
}

// Original-input board evaluation uses zero for an unspecified edge rule and
// the pinned copper-to-board checker compares with a 1e-9 mm epsilon.
const BOARD_GEOMETRY_EPSILON = 1e-9

/** Retain physical board coordinates while node searches grow or change layers. */
export const getPipeline9ViaBoardPlacementValidator = (
  geometry: HighDensityBoardGeometry,
): ((placement: ViaPlacement) => boolean) => {
  const { minX, maxX, minY, maxY } = geometry.bounds
  const clearance = geometry.minBoardEdgeClearance ?? 0
  if (![minX, maxX, minY, maxY, clearance].every(Number.isFinite) ||
    minX >= maxX || minY >= maxY || clearance < 0) {
    throw new Error("Invalid original via-placement board geometry")
  }
  // Snapshot coordinates once. Neither the mutable routing SRJ nor a grown
  // node rectangle can subsequently replace the original physical outline.
  const polygon = geometry.outline?.length
    ? geometry.outline.map(({ x, y }) => ({ x, y }))
    : [{ x: minX, y: minY }, { x: maxX, y: minY },
      { x: maxX, y: maxY }, { x: minX, y: maxY }]
  if (polygon.length < 3 || polygon.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error("Invalid original via-placement board outline")
  }
  const origin = polygon[0]!
  let twiceArea = 0
  const edges: BoardEdge[] = []
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i]!
    const end = polygon[(i + 1) % polygon.length]!
    const dx = end.x - start.x
    const dy = end.y - start.y
    twiceArea += (start.x - origin.x) * (end.y - origin.y) -
      (end.x - origin.x) * (start.y - origin.y)
    const lengthSquared = dx * dx + dy * dy
    if (lengthSquared > 0) edges.push({ ...start, dx, dy, lengthSquared })
  }
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) <= 2 * BOARD_GEOMETRY_EPSILON) {
    throw new Error("Invalid original via-placement board outline")
  }
  return (placement): boolean => {
    let inside = false
    let minimumDistanceSquared = Infinity
    for (const edge of edges) {
      const endY = edge.y + edge.dy
      if ((edge.y > placement.y) !== (endY > placement.y) &&
        placement.x < edge.x + edge.dx * (placement.y - edge.y) / edge.dy) {
        inside = !inside
      }
      const t = Math.max(0, Math.min(1,
        ((placement.x - edge.x) * edge.dx + (placement.y - edge.y) * edge.dy) / edge.lengthSquared))
      const distanceSquared = (placement.x - edge.x - t * edge.dx) ** 2 +
        (placement.y - edge.y - t * edge.dy) ** 2
      minimumDistanceSquared = Math.min(minimumDistanceSquared, distanceSquared)
    }
    // A contained center alone is insufficient, including at concave corners.
    // The nearest finite outline segment must clear the entire circular pad.
    return inside && Math.sqrt(minimumDistanceSquared) + BOARD_GEOMETRY_EPSILON >=
      placement.viaDiameter / 2 + clearance
  }
}
