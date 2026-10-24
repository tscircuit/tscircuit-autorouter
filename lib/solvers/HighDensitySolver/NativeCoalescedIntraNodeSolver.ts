import { CachedIntraNodeRouteSolver } from "./CachedIntraNodeRouteSolver"

type Params = ConstructorParameters<typeof CachedIntraNodeRouteSolver>[0] & {
  nativeOrderingFamilySize: number
}

/** A single original native ordering with its removed family's upper allowance.
 * This controls candidate coalescing only: all inherited native search, copper,
 * futures, cache and low-level caps remain. The whole-Intra clock is native,
 * unlike H5's explicit graph/pair/setup charges, so equal ceilings are not equal
 * CPU effort. Keep the original per-candidate cap for adaptive expansion.
 */
export class NativeCoalescedIntraNodeSolver extends CachedIntraNodeRouteSolver {
  readonly nativeCandidateIterationLimit: number
  readonly nativeOrderingFamilySize: number

  constructor(params: Params) {
    super(params)
    const family = params.nativeOrderingFamilySize
    if (!Number.isSafeInteger(family) || family < 1) {
      throw new Error("Invalid native ordering family allocation")
    }
    this.nativeCandidateIterationLimit = this.MAX_ITERATIONS
    this.nativeOrderingFamilySize = family
    const allowance = family * (Math.floor(this.MAX_ITERATIONS) + 1) - 1
    if (!Number.isSafeInteger(allowance) || allowance < 0) {
      throw new Error("Unsafe native coalesced family allowance")
    }
    this.MAX_ITERATIONS = allowance
  }
}
