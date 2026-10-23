import type { Bounds } from "./repairRegionTypes"
import { REGION_EPSILON } from "./repairRegionGeometry"

/** Strict separation only; retain exact geometry checks near the boundary. */
export function areExpandedBoundsSeparated(
  a: Bounds,
  b: Bounds,
  reach: number,
): boolean {
  return (
    a.minX - reach - REGION_EPSILON > b.maxX ||
    a.maxX + reach + REGION_EPSILON < b.minX ||
    a.minY - reach - REGION_EPSILON > b.maxY ||
    a.maxY + reach + REGION_EPSILON < b.minY
  )
}
