const MIN_NORMAL_SQUARED_AXIS = 2 ** -511
const AXIS_WIDENING = 1 - 2 * Number.EPSILON

function eligible(dx: number, dy: number, base: number, best: number, scale: number): boolean {
  return Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(base) &&
    Number.isFinite(best) && Number.isFinite(scale) && scale > 0
}

/** Only proves a rejection of the native base + sqrt(dx*dx + dy*dy)*scale. */
export function canRejectTinyDistanceByBase(
  dx: number, dy: number, base: number, best: number, scale: number,
): boolean {
  return eligible(dx, dy, base, best, scale) && base >= best
}

/**
 * Lower bound for the native rounded deltas, not the unrounded coordinates.
 * For u = EPSILON/2, the widened axis is at most axis*(1-3u), while the
 * normal dominant square and rounded square root are at least axis*(1-u)^2.
 * Positive multiplication and addition preserve that ordering. Overflow of
 * the native squares or sum yields Infinity and also preserves the bound.
 */
export function canRejectTinyDistanceByAxis(
  dx: number, dy: number, base: number, best: number, scale: number,
): boolean {
  if (!eligible(dx, dy, base, best, scale)) return false
  if (base >= best) return true
  const axis = Math.max(Math.abs(dx), Math.abs(dy))
  if (axis < MIN_NORMAL_SQUARED_AXIS) return false
  return base + (axis * AXIS_WIDENING) * scale >= best
}
