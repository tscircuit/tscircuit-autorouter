export type SearchInputs = {
  traceCost: Uint16Array
  viaCost: Uint16Array
  fixed: Uint8Array
  fixedVia: Uint8Array
  history: Float64Array
  viaHistory: Float64Array
  heuristicCost: Float64Array
  viaAllowed: Uint8Array
}
