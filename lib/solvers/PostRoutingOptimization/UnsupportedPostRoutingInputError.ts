/** The physical input is outside this phase's declared validation contract.
 * This is distinct from a malformed input, invalid original board or invariant.
 */
export class UnsupportedPostRoutingInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsupportedPostRoutingInputError"
  }
}
