import type { SimpleRouteConnection } from "lib/types"

/**
 * Resolves the effective nominal trace width for a connection.
 *
 * Priority:
 * 1. Explicit `nominalTraceWidth` on the connection (takes precedence)
 * 2. `traceWidthMultiplier * minTraceWidth` if multiplier is set
 * 3. `undefined` (no width override — uses minTraceWidth as-is)
 */
export function getEffectiveNominalTraceWidth(
  connection: SimpleRouteConnection,
  minTraceWidth: number,
): number | undefined {
  if (connection.nominalTraceWidth !== undefined) {
    return connection.nominalTraceWidth
  }
  if (
    connection.traceWidthMultiplier !== undefined &&
    connection.traceWidthMultiplier > 1
  ) {
    return connection.traceWidthMultiplier * minTraceWidth
  }
  return undefined
}
