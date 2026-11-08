import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import type { Obstacle } from "lib/types"
import type { SharedEdge } from "./types"

/** Intersect a mesh edge with the clearance envelope of a physical pad. */
export const getObstacleClearanceInterval = (
  edge: SharedEdge,
  obstacle: Obstacle,
  clearance: number,
): { min: number; max: number; center: number } | undefined => {
  const vertical = edge.orientation === "vertical"
  const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const halfX =
    (Math.abs(cos) * obstacle.width + Math.abs(sin) * obstacle.height) / 2
  const halfY =
    (Math.abs(sin) * obstacle.width + Math.abs(cos) * obstacle.height) / 2
  const fixed = vertical ? edge.x1 : edge.y1
  const centerFixed = vertical ? obstacle.center.x : obstacle.center.y
  const halfFixed = vertical ? halfX : halfY
  if (Math.abs(fixed - centerFixed) >= halfFixed + clearance - 1e-10)
    return undefined
  const centerAlong = vertical ? obstacle.center.y : obstacle.center.x
  const halfAlong = vertical ? halfY : halfX
  let min = centerAlong - halfAlong - clearance
  let max = centerAlong + halfAlong + clearance
  const edgeMin = Math.min(
    vertical ? edge.y1 : edge.x1,
    vertical ? edge.y2 : edge.x2,
  )
  const edgeMax = Math.max(
    vertical ? edge.y1 : edge.x1,
    vertical ? edge.y2 : edge.x2,
  )
  if (max < edgeMin || min > edgeMax) return undefined
  const distance = (along: number): number => {
    const x = (vertical ? fixed : along) - obstacle.center.x
    const y = (vertical ? along : fixed) - obstacle.center.y
    if (obstacle.shape === "circle")
      return Math.hypot(x, y) - obstacle.width / 2
    const local = { x: x * cos + y * sin, y: -x * sin + y * cos }
    return segmentToBoundsMinDistance(local, local, {
      minX: -obstacle.width / 2,
      maxX: obstacle.width / 2,
      minY: -obstacle.height / 2,
      maxY: obstacle.height / 2,
    })
  }
  // Distance to a convex pad is convex along a straight mesh boundary. Find
  // an interior point even when a rotated corner is closest to that boundary.
  let left = min
  let right = max
  for (let i = 0; i < 50; i++) {
    const a = left + (right - left) / 3
    const b = right - (right - left) / 3
    if (distance(a) < distance(b)) right = b
    else left = a
  }
  const center = (left + right) / 2
  if (distance(center) >= clearance) return undefined
  let inside = center
  for (let i = 0; i < 40; i++) {
    const mid = (min + inside) / 2
    if (distance(mid) < clearance) inside = mid
    else min = mid
  }
  inside = center
  for (let i = 0; i < 40; i++) {
    const mid = (max + inside) / 2
    if (distance(mid) < clearance) inside = mid
    else max = mid
  }
  return { min, max, center }
}
