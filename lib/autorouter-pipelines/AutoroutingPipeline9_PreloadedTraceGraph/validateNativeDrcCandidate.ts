import type { DrcEvaluator } from "high-density-repair03/lib"

/** A native zero is only a candidate until the independent checker confirms it. */
export function validateNativeDrcCandidate(
  native: ReturnType<DrcEvaluator>,
  reference: () => ReturnType<DrcEvaluator>,
): ReturnType<DrcEvaluator> {
  const errors = Array.isArray(native) ? native : native.errors
  if (errors.length === 0) return reference()
  return native
}
