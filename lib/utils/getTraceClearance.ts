/**
 * Compute the minimum clearance (keep-out margin) that must be maintained
 * between the *centre line* of a trace and the edge of an obstacle.
 *
 * The IPC-2221 rule of thumb is:
 *   clearance = traceWidth / 2 + minClearanceGap
 *
 * where `minClearanceGap` is the smallest air-gap allowed between conductor
 * edges (defaults to 0.1 mm for standard PCB manufacturing).
 *
 * @param traceWidthMm       Width of the trace being routed, in mm.
 * @param minClearanceGapMm  Minimum conductor-to-conductor gap, in mm.
 *                           Defaults to 0.1 mm.
 * @returns Required margin from obstacle *edge* to trace *centre*, in mm.
 */
export function getTraceClearance(
  traceWidthMm: number,
  minClearanceGapMm = 0.1,
): number {
  return traceWidthMm / 2 + minClearanceGapMm
}

/**
 * Compute the total keep-out distance between the *centres* of two adjacent
 * traces (half-widths plus the minimum gap between their edges).
 *
 * @param traceWidthA        Width of the first trace, in mm.
 * @param traceWidthB        Width of the second trace, in mm.
 * @param minClearanceGapMm  Minimum edge-to-edge air gap, in mm.
 */
export function getTraceToCentreDistance(
  traceWidthA: number,
  traceWidthB: number,
  minClearanceGapMm = 0.1,
): number {
  return traceWidthA / 2 + traceWidthB / 2 + minClearanceGapMm
}
