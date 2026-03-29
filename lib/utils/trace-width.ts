/**
 * Utility helpers for trace-width–aware routing computations.
 *
 * Routing algorithms need to account for:
 *  1. The physical width of the trace being placed.
 *  2. The minimum clearance between traces / pads and the new trace.
 *
 * The total "keep-out" half-width of a trace is:
 *   traceHalfWidth + minClearance
 *
 * This is the radius of the swept rectangle / capsule that must remain
 * free of all other copper features.
 */

import {
  TRACE_BASE_WIDTH_MM,
  TraceThicknessConfig,
  resolveTraceWidth,
  traceHalfWidth,
} from "../types/trace-thickness"

/** Minimum copper-to-copper clearance in mm (IPC-2221 Class B default). */
export const DEFAULT_MIN_CLEARANCE_MM = 0.15

/**
 * The effective obstacle radius for a segment of the given width when placed
 * next to traces/pads that themselves have `minClearanceMm` of required gap.
 */
export function effectiveObstacleRadius(
  widthMm: number,
  minClearanceMm: number = DEFAULT_MIN_CLEARANCE_MM,
): number {
  return traceHalfWidth(widthMm) + minClearanceMm
}

/**
 * The minimum centre-to-centre distance between two traces so that they
 * do not violate DRC clearance rules.
 *
 * @param widthA  Width of trace A in mm
 * @param widthB  Width of trace B in mm
 * @param clearanceMm  Required gap between copper edges in mm
 */
export function minCentreDistance(
  widthA: number,
  widthB: number,
  clearanceMm: number = DEFAULT_MIN_CLEARANCE_MM,
): number {
  return traceHalfWidth(widthA) + traceHalfWidth(widthB) + clearanceMm
}

/**
 * Compute the grid step that should be used when routing a trace of a given
 * width.  Thicker traces need a coarser grid so the router doesn't attempt
 * to squeeze them into gaps that are too tight.
 *
 * The heuristic is:
 *   gridStep = traceWidth + minClearance   (rounded to nearest 0.05 mm)
 */
export function recommendedGridStep(
  widthMm: number,
  minClearanceMm: number = DEFAULT_MIN_CLEARANCE_MM,
): number {
  const raw = widthMm + minClearanceMm
  // Round up to nearest 0.05 mm increment so we stay on a sane grid
  return Math.ceil(raw / 0.05) * 0.05
}

/**
 * Return true if two trace centre-lines are close enough to be "adjacent"
 * (i.e. their copper edges are within `touchThresholdMm` of each other).
 * This can be used for trace-adjacency / net-merging decisions.
 */
export function areTracesAdjacent(
  centerA: number,
  centerB: number,
  widthA: number,
  widthB: number,
  touchThresholdMm: number = 0.01,
): boolean {
  const dist = Math.abs(centerA - centerB)
  return dist <= traceHalfWidth(widthA) + traceHalfWidth(widthB) + touchThresholdMm
}

/**
 * Resolve and validate a trace-width config object or raw mm number.
 * Exported so callers don't need to import from two places.
 */
export { resolveTraceWidth } from "../types/trace-thickness"
