import type { SimpleRouteConnection } from "../types"

/**
 * Resolves the effective nominal trace width for a connection.
 *
 * Priority:
 * 1. `nominalTraceWidth` if explicitly set
 * 2. `traceWidthMultiplier * minTraceWidth` if multiplier is set
 * 3. `undefined` (caller falls back to minTraceWidth)
 */
export function getEffectiveNominalTraceWidth(
  connection: SimpleRouteConnection,
  minTraceWidth: number,
): number | undefined {
  if (connection.nominalTraceWidth !== undefined) {
    return connection.nominalTraceWidth
  }
  if (connection.traceWidthMultiplier !== undefined) {
    return connection.traceWidthMultiplier * minTraceWidth
  }
  return undefined
}
