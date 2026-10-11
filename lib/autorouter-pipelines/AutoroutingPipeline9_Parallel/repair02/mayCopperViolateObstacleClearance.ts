import { EPSILON } from "high-density-repair02/lib/high-density-repair-solver/shared/constants"
import type { Obstacle, XY } from "high-density-repair02/lib/high-density-repair-solver/shared/types"

type CopperBoundsInput = { start: XY; end: XY; radius: number }

/**
 * Conservative rejection for the native rectangle-conflict objective only.
 * Exact clearance values used by acceptance guards still use the native kernel.
 * Nonfinite, negative, tiny, and large geometry retains the original traversal.
 */
export function mayCopperViolateObstacleClearance(
  copper: CopperBoundsInput,
  obstacle: Obstacle,
  clearance: number,
): boolean {
  if (!obstacle.center || obstacle.width === undefined || obstacle.height === undefined) return true
  const sx = copper.start.x
  const sy = copper.start.y
  const ex = copper.end.x
  const ey = copper.end.y
  const cx = obstacle.center.x
  const cy = obstacle.center.y
  const width = obstacle.width
  const height = obstacle.height
  const radius = copper.radius
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) ||
    !Number.isFinite(ey) || !Number.isFinite(cx) || !Number.isFinite(cy) ||
    !Number.isFinite(width) || !Number.isFinite(height) || !Number.isFinite(radius) ||
    !Number.isFinite(clearance) || width < 0 || height < 0 || radius < 0 || clearance < 0) return true
  const magnitude = Math.max(Math.abs(sx), Math.abs(sy), Math.abs(ex), Math.abs(ey),
    Math.abs(cx), Math.abs(cy), width, height, radius, clearance)
  if (magnitude > 1_000_000) return true
  const minimumInputMagnitude = Math.min(
    sx === 0 ? Infinity : Math.abs(sx), sy === 0 ? Infinity : Math.abs(sy),
    ex === 0 ? Infinity : Math.abs(ex), ey === 0 ? Infinity : Math.abs(ey),
    cx === 0 ? Infinity : Math.abs(cx), cy === 0 ? Infinity : Math.abs(cy),
    width === 0 ? Infinity : width, height === 0 ? Infinity : height,
    radius === 0 ? Infinity : radius, clearance === 0 ? Infinity : clearance,
  )
  // Tiny values can underflow native orientation products into zero and make
  // its sign test report an intersection outside both segment bounds. Above
  // this lower domain, inputs are multiples of 2^-302, half-dimensions and
  // coordinate differences of 2^-303, and products of 2^-606: all are normal.
  if (minimumInputMagnitude < 1e-75) return true
  const left = cx - width / 2
  const right = cx + width / 2
  const bottom = cy - height / 2
  const top = cy + height / 2
  const dx = ex - sx
  const dy = ey - sy
  const segmentWidth = right - left
  const segmentHeight = top - bottom
  const startLeft = sx - left
  const startRight = sx - right
  const endLeft = ex - left
  const endRight = ex - right
  const startBottom = sy - bottom
  const startTop = sy - top
  const endBottom = ey - bottom
  const endTop = ey - top
  const minimumDifferenceMagnitude = Math.min(
    dx === 0 ? Infinity : Math.abs(dx), dy === 0 ? Infinity : Math.abs(dy),
    left === 0 ? Infinity : Math.abs(left), right === 0 ? Infinity : Math.abs(right),
    bottom === 0 ? Infinity : Math.abs(bottom), top === 0 ? Infinity : Math.abs(top),
    segmentWidth === 0 ? Infinity : Math.abs(segmentWidth), segmentHeight === 0 ? Infinity : Math.abs(segmentHeight),
    startLeft === 0 ? Infinity : Math.abs(startLeft), startRight === 0 ? Infinity : Math.abs(startRight),
    endLeft === 0 ? Infinity : Math.abs(endLeft), endRight === 0 ? Infinity : Math.abs(endRight),
    startBottom === 0 ? Infinity : Math.abs(startBottom), startTop === 0 ? Infinity : Math.abs(startTop),
    endBottom === 0 ? Infinity : Math.abs(endBottom), endTop === 0 ? Infinity : Math.abs(endTop),
  )
  if (minimumDifferenceMagnitude < 1e-75) return true
  const reach = clearance + radius
  // onSegment admits endpoints EPSILON outside the rectangle. Rounding in
  // rectangle bounds, projection and radius arithmetic gets an outward guard.
  const padding = EPSILON * 2 + Number.EPSILON * 32 * (magnitude + reach + 1)
  const expandedReach = reach + padding
  return !(Math.min(sx, ex) - expandedReach > right ||
    Math.max(sx, ex) + expandedReach < left ||
    Math.min(sy, ey) - expandedReach > top ||
    Math.max(sy, ey) + expandedReach < bottom)
}
