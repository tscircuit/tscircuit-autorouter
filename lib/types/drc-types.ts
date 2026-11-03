export interface GetDrcErrorsOptions {
  holeClearance?: number
  viaClearance?: number
  /** Via copper edge to unrelated pad copper edge; independent of drill spacing. */
  viaToPadClearance?: number
  /** Overrides only wire-to-wire clearance, preserving pad and via rules. */
  differentNetTraceClearance?: number
  traceClearance?: number
  includeTraceContinuity?: boolean
  includeTypedTraceClearance?: boolean
}
