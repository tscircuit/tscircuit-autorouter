import type { RoutingFailure } from "lib/types/routingResult"

/** Keep plain failure data intact across errors, async adapters and serialization. */
export const getRoutingFailure = (error: unknown): RoutingFailure => {
  if (
    typeof error === "object" &&
    error !== null &&
    "routingFailure" in error &&
    error.routingFailure !== undefined &&
    error.routingFailure !== null
  )
    return error.routingFailure as RoutingFailure
  return {
    reason: "routing_failed",
    message: error instanceof Error ? error.message : String(error),
  }
}
