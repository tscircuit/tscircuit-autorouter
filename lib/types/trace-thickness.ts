/**
 * Trace thickness definitions for the autorouter.
 *
 * The industry standard data-line trace width is 0.15mm.
 * We support multiples of this base width for power traces:
 *   - 1x  → 0.15mm  (standard data line)
 *   - 2x  → 0.30mm
 *   - 4x  → 0.60mm
 *   - 8x  → 1.20mm
 */

export const TRACE_BASE_WIDTH_MM = 0.15;

export type TraceThicknessMultiple = 1 | 2 | 4 | 8;

export const TRACE_THICKNESS_MULTIPLES: TraceThicknessMultiple[] = [1, 2, 4, 8];

export interface TraceThicknessConfig {
  /** Multiplier relative to the base trace width (0.15mm). Default: 1 */
  widthMultiple?: TraceThicknessMultiple;
  /** Explicit width in mm. Overrides widthMultiple when set. */
  widthMm?: number;
}

/**
 * Resolve a TraceThicknessConfig (or a raw mm value) to an actual mm width.
 * Falls back to the base width when nothing is specified.
 */
export function resolveTraceWidth(
  config?: TraceThicknessConfig | number | null,
): number {
  if (config === undefined || config === null) {
    return TRACE_BASE_WIDTH_MM;
  }
  if (typeof config === "number") {
    return config > 0 ? config : TRACE_BASE_WIDTH_MM;
  }
  if (config.widthMm !== undefined && config.widthMm > 0) {
    return config.widthMm;
  }
  if (config.widthMultiple !== undefined) {
    return TRACE_BASE_WIDTH_MM * config.widthMultiple;
  }
  return TRACE_BASE_WIDTH_MM;
}

/**
 * Given a desired width in mm, return the nearest supported multiple
 * (rounding up to ensure we never under-spec a power trace).
 */
export function nearestSupportedMultiple(
  widthMm: number,
): TraceThicknessMultiple {
  const ratio = widthMm / TRACE_BASE_WIDTH_MM;
  // Round up and clamp to valid multiples
  for (const m of TRACE_THICKNESS_MULTIPLES) {
    if (m >= ratio) return m;
  }
  return 8;
}

/**
 * Half-width helper (used extensively in clearance / obstacle calculations).
 */
export function traceHalfWidth(widthMm: number): number {
  return widthMm / 2;
}
