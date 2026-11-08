import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { SharedEdge } from "./types"
type Point = { x: number; y: number }

/** Locate the intersection of a wire's clearance capsule with a mesh edge. */
export const getWireClearanceInterval = (
  edge: SharedEdge,
  a: Point,
  b: Point,
  radius: number,
): { min: number; max: number; center: number } | undefined => {
  const vertical = edge.orientation === "vertical"
  const fixed = vertical ? edge.x1 : edge.y1
  const aFixed = vertical ? a.x : a.y
  const bFixed = vertical ? b.x : b.y
  const aAlong = vertical ? a.y : a.x
  const bAlong = vertical ? b.y : b.x
  const t =
    aFixed === bFixed
      ? 0.5
      : Math.max(0, Math.min(1, (fixed - aFixed) / (bFixed - aFixed)))
  const center = aAlong + (bAlong - aAlong) * t
  const distance = (along: number): number => {
    const point = vertical ? { x: fixed, y: along } : { x: along, y: fixed }
    return segmentToSegmentMinDistance(a, b, point, point)
  }
  if (distance(center) >= radius) return undefined
  let min = Math.min(aAlong, bAlong) - radius
  let max = Math.max(aAlong, bAlong) + radius
  let inside = center
  for (let i = 0; i < 40; i++) {
    const mid = (min + inside) / 2
    if (distance(mid) < radius) inside = mid
    else min = mid
  }
  inside = center
  for (let i = 0; i < 40; i++) {
    const mid = (max + inside) / 2
    if (distance(mid) < radius) inside = mid
    else max = mid
  }
  return { min, max, center }
}
