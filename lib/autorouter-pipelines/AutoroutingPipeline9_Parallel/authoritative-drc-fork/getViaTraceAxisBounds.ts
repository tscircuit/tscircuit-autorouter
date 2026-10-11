import type { PcbVia } from "circuit-json"
import type { PcbTraceSegment } from "./native/lib/check-each-pcb-trace-non-overlapping/getCollidableBounds"

export type ViaTraceAxisBounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
  traceRadius: number
}
export type ViaTraceAxisQuery = { x: number; y: number; radius: number; minClearance: number }

const maximumMagnitude = 10_000
const outwardPadding = 1e-8

export function getViaTraceAxisBounds(segment: PcbTraceSegment): ViaTraceAxisBounds | undefined {
  if (Math.abs(segment.x1) > maximumMagnitude || Math.abs(segment.x2) > maximumMagnitude ||
    Math.abs(segment.y1) > maximumMagnitude || Math.abs(segment.y2) > maximumMagnitude ||
    !Number.isFinite(segment.x1) || !Number.isFinite(segment.x2) || !Number.isFinite(segment.y1) || !Number.isFinite(segment.y2) ||
    !Number.isFinite(segment.thickness) || segment.thickness < 0 || segment.thickness > maximumMagnitude) return undefined
  const dx = segment.x2 - segment.x1
  const dy = segment.y2 - segment.y1
  // Distinct subnormal endpoints can have zero squared length. The native
  // quotient then produces NaN and can publish an error even for a distant via.
  if (!(segment.x1 === segment.x2 && segment.y1 === segment.y2) && !(dx * dx + dy * dy > 0)) return undefined
  return {
    minX: Math.min(segment.x1, segment.x2), maxX: Math.max(segment.x1, segment.x2),
    minY: Math.min(segment.y1, segment.y2), maxY: Math.max(segment.y1, segment.y2),
    traceRadius: segment.thickness / 2,
  }
}

export function getViaTraceAxisQuery(via: PcbVia, minClearance: number): ViaTraceAxisQuery | undefined {
  if (!Number.isFinite(via.x) || !Number.isFinite(via.y) || Math.abs(via.x) > maximumMagnitude || Math.abs(via.y) > maximumMagnitude ||
    !Number.isFinite(via.outer_diameter) || via.outer_diameter < 0 || via.outer_diameter > maximumMagnitude ||
    !Number.isFinite(minClearance) || minClearance < 0 || minClearance > maximumMagnitude) return undefined
  return { x: via.x, y: via.y, radius: via.outer_diameter / 2, minClearance }
}

/**
 * Finite-domain exclusion, after the original live connectivity query.
 * With coordinates bounded by 10000 and nonzero native squared length, the
 * native clamped parameter is in [0,1]. Rounding of endpoint subtraction,
 * multiplication and addition moves its nearest point at most 70000u outside
 * the endpoint box (u=2^-53). Axis subtraction, squared distance/sqrt and the
 * two radius subtractions bring the total absolute loss below 3e-11. The three
 * reach additions lose less than 6e-12. Our 1e-8 outward margin exceeds both.
 * A rejected native gap is strictly greater than minClearance>=0, preserving
 * both overlap-map deletion and the native gap+0.005 clearance test. In a
 * rejecting pair the dominant squared distance is normal (axis>1e-8), so tiny
 * coordinates and other underflowing terms do not invalidate that bound.
 */
export function isViaTraceAxisSeparated(bounds: ViaTraceAxisBounds, via: ViaTraceAxisQuery): boolean {
  const reach = via.radius + bounds.traceRadius + via.minClearance + outwardPadding
  if (via.x < bounds.minX && bounds.minX - via.x > reach) return true
  if (via.x > bounds.maxX && via.x - bounds.maxX > reach) return true
  if (via.y < bounds.minY && bounds.minY - via.y > reach) return true
  if (via.y > bounds.maxY && via.y - bounds.maxY > reach) return true
  return false
}
