import type { DifferentialPairFailure } from "lib/types/routingResult"

export class DifferentialPairRoutingError extends Error {
  constructor(
    public readonly routingFailure: DifferentialPairFailure,
    message: string,
    public readonly selfContact?: {
      routeIndex: number
      firstSegmentEnd: { x: number; y: number }
      secondSegmentStart: { x: number; y: number }
    },
  ) {
    super(`Differential pair: ${message}`)
    this.name = "DifferentialPairRoutingError"
  }
}
