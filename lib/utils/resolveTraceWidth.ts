import type { SimpleRouteConnection } from "../types/SimpleRouteJson"
import {
  BASE_TRACE_WIDTH_MM,
  traceWidthFromMultiplier,
  type TraceThicknessMultiplier,
} from "../types/TraceThickness"

/**
 * Determine the effective trace width in millimetres for a connection.
 *
 * Priority order:
 * 1. `connection.traceWidth`  – explicit mm value supplied by the caller.
 * 2. `connection.thicknessMultiplier` – one of 1 | 2 | 4 | 8 × 0.15 mm.
 * 3. `defaultWidth` argument (falls back to BASE_TRACE_WIDTH_MM = 0.15 mm).
 */
export function resolveTraceWidth(
  connection: Pick<
    SimpleRouteConnection,
    "traceWidth" | "thicknessMultiplier"
  >,
  defaultWidth: number = BASE_TRACE_WIDTH_MM,
): number {
  if (
    connection.traceWidth !== undefined &&
    connection.traceWidth !== null &&
    connection.traceWidth > 0
  ) {
    return connection.traceWidth
  }

  if (connection.thicknessMultiplier !== undefined) {
    return traceWidthFromMultiplier(
      connection.thicknessMultiplier as TraceThicknessMultiplier,
    )
  }

  return defaultWidth
}
