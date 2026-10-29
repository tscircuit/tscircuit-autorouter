import type { SimpleRouteJson } from "lib/types"

const MINIMUM_POWER_WIDTH_INCREASE_MM = 0.1
const MINIMUM_POWER_WIDTH_RATIO = 2

/**
 * Select connections whose requested width is materially larger than the
 * board's ordinary routing width. This keeps signal and differential-pair
 * traces out of every mutating power-expansion pass by default.
 */
export const getPowerTraceExpansionConnectionNames = (
  srj: SimpleRouteJson,
): string[] => {
  const minimumPowerWidth = Math.max(
    srj.minTraceWidth + MINIMUM_POWER_WIDTH_INCREASE_MM,
    srj.minTraceWidth * MINIMUM_POWER_WIDTH_RATIO,
  )
  return srj.connections.flatMap((connection) => {
    const nominalWidth =
      connection.nominalTraceWidth ?? srj.nominalTraceWidth ?? srj.minTraceWidth
    return nominalWidth + 1e-6 >= minimumPowerWidth ? [connection.name] : []
  })
}
