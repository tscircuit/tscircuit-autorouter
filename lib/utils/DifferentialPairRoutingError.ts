export class DifferentialPairRoutingError extends Error {
  constructor(message: string) {
    super(`Differential pair: ${message}`)
    this.name = "DifferentialPairRoutingError"
  }
}
