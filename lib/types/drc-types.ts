export interface GetDrcErrorsOptions {
  holeClearance?: number
  viaClearance?: number
  /** Via copper edge to unrelated pad copper edge; independent of drill spacing. */
  viaToPadClearance?: number
  traceClearance?: number
  includeTraceContinuity?: boolean
  /** Physical connections supplied by retained copper outside routed traces. */
  externallyConnectedPortIds?: string[][]
  includeTypedTraceClearance?: boolean
}
