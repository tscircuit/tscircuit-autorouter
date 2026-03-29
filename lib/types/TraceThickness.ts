/**
 * Trace thickness multipliers relative to the industry-standard data line
 * thickness of 0.15mm.
 *
 * | Multiplier | Thickness | Typical use           |
 * |------------|-----------|----------------------|
 * | 1x         | 0.15 mm   | Signal / data lines  |
 * | 2x         | 0.30 mm   | Low-power supply     |
 * | 4x         | 0.60 mm   | Medium-power supply  |
 * | 8x         | 1.20 mm   | High-power / ground  |
 */
export type TraceThicknessMultiplier = 1 | 2 | 4 | 8

/** Base trace width in millimetres (industry standard data-line width). */
export const BASE_TRACE_WIDTH_MM = 0.15

/**
 * Convert a thickness multiplier to an absolute width in millimetres.
 */
export function traceWidthFromMultiplier(
  multiplier: TraceThicknessMultiplier,
): number {
  return BASE_TRACE_WIDTH_MM * multiplier
}

/**
 * Round an arbitrary width in millimetres to the nearest supported
 * multiplier.  Values that cannot be mapped exactly are rounded to the
 * closest supported step.
 */
export function multiplierFromTraceWidth(
  widthMm: number,
): TraceThicknessMultiplier {
  const raw = widthMm / BASE_TRACE_WIDTH_MM
  const supported: TraceThicknessMultiplier[] = [1, 2, 4, 8]
  let best: TraceThicknessMultiplier = 1
  let bestDiff = Infinity
  for (const m of supported) {
    const diff = Math.abs(raw - m)
    if (diff < bestDiff) {
      bestDiff = diff
      best = m
    }
  }
  return best
}
