import type { PcbTrace } from "circuit-json"

/**
 * Borrows immutable converted interior points for private Pipeline9 checks.
 * Pinned native checks only write port IDs on the literal first/last points;
 * the trace, array and both writable boundary points remain evaluator-owned.
 */
export const clonePipeline9TraceForDrc = (trace: PcbTrace): PcbTrace => {
  const route = trace.route.slice()
  if (route.length > 0) route[0] = { ...route[0]! }
  if (route.length > 1) {
    const lastIndex = route.length - 1
    route[lastIndex] = { ...route[lastIndex]! }
  }
  return { ...trace, route }
}
