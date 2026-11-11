import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import type { RoutingFailure } from "lib/types/routingResult"
import { assertDifferentialPairOutput } from "./assertDifferentialPairOutput"
import { getRoutingFailure } from "./getRoutingFailure"

/** Validate final copper from any router, including cached or custom output.
 * Returns plain failure data suitable for worker and consumer boundaries. */
export const getDifferentialPairRoutingFailure = (
  input: SimpleRouteJson,
  traces: SimplifiedPcbTraces,
): RoutingFailure | undefined => {
  try {
    assertDifferentialPairOutput(input, traces)
  } catch (error) {
    return getRoutingFailure(error)
  }
}
