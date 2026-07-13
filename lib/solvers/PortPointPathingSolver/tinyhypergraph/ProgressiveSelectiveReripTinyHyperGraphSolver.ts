import { SelectiveReripTinyHyperGraphSolver } from "tiny-hypergraph/lib/index"

const EARLY_COMPLETE_ROUTE_CANDIDATE_ITERATIONS = 200_000

/**
 * Tests one complete route assignment before selective reripping has time to
 * degrade a routable partial state. A candidate is accepted only when it
 * routes every remaining connection; otherwise the selective solver state is
 * left intact and its normal search continues.
 */
export class ProgressiveSelectiveReripTinyHyperGraphSolver extends SelectiveReripTinyHyperGraphSolver {
  private attemptedEarlyCompleteRouteCandidate = false

  override _step(): void {
    if (
      !this.attemptedEarlyCompleteRouteCandidate &&
      this.iterations >= EARLY_COMPLETE_ROUTE_CANDIDATE_ITERATIONS
    ) {
      this.attemptedEarlyCompleteRouteCandidate = true
      if (this.tryGreedyFinalRouteAcceptance()) {
        this.stats = {
          ...this.stats,
          acceptedEarlyCompleteRouteCandidate: true,
          earlyCompleteRouteCandidateIterations:
            EARLY_COMPLETE_ROUTE_CANDIDATE_ITERATIONS,
        }
        return
      }
    }

    super._step()
  }
}
