import type { DifferentialPairFailure } from "lib/types/routingResult"

export class DifferentialPairRoutingError extends Error {
  constructor(
    public readonly routingFailure: DifferentialPairFailure,
    message: string,
  ) {
    super(`Differential pair: ${message}`)
    this.name = "DifferentialPairRoutingError"
  }
}
