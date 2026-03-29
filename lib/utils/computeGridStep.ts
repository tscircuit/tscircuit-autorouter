import { BASE_TRACE_WIDTH_MM } from "../types/TraceThickness"

/**
 * Compute the grid step (cell size) for the pathfinding grid given the trace
 * width that will be routed.
 *
 * The grid step should be at least as large as the trace width so that
 * every cell on the grid can physically accommodate the trace.  We also
 * ensure the step is a whole-number multiple of the base trace width so
 * that routing at different thickness levels share compatible grids when
 * a multi-thickness board is processed.
 *
 * Recommended values:
 *   1× (0.15 mm) → 0.15 mm  step
 *   2× (0.30 mm) → 0.30 mm  step
 *   4× (0.60 mm) → 0.60 mm  step
 *   8× (1.20 mm) → 1.20 mm  step
 *
 * @param traceWidthMm  Effective trace width in mm.
 * @returns             Suggested grid step size in mm.
 */
export function computeGridStep(traceWidthMm: number): number {
  // Round up to the next multiple of BASE_TRACE_WIDTH_MM so that the grid is
  // always aligned to the base grid.
  const steps = Math.ceil(traceWidthMm / BASE_TRACE_WIDTH_MM)
  return steps * BASE_TRACE_WIDTH_MM
}
