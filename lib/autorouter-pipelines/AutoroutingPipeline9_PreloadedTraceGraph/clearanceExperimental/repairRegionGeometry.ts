import type { Bounds } from "./repairRegionTypes"
export const REGION_EPSILON = 1e-8
export function isPointInBounds(point: { x: number; y: number }, bounds: Bounds, epsilon = 0): boolean {
  return point.x >= bounds.minX - epsilon && point.x <= bounds.maxX + epsilon && point.y >= bounds.minY - epsilon && point.y <= bounds.maxY + epsilon
}
