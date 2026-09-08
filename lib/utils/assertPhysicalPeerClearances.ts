type PhysicalPeerClearances = {
  readonly traceToTraceClearance: number
  readonly viaToTraceClearance: number
}

export const assertPhysicalPeerClearances = ({
  traceToTraceClearance,
  viaToTraceClearance,
}: PhysicalPeerClearances): void => {
  if (
    !Number.isFinite(traceToTraceClearance) ||
    traceToTraceClearance < 0 ||
    !Number.isFinite(viaToTraceClearance) ||
    viaToTraceClearance < 0
  ) {
    throw new Error("Physical peer clearances must be finite and nonnegative")
  }
}
