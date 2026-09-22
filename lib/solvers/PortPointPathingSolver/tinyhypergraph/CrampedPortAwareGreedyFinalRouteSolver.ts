import { type Candidate, TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"

/** Preserve cramped-boundary preferences in the otherwise cost-free final pass. */
export class CrampedPortAwareGreedyFinalRouteSolver extends TinyHyperGraphSolver {
  override computeG(
    currentCandidate: Candidate,
    neighborPortId: number,
  ): number {
    // Retain the upstream greedy pass's behavior for ordinary ports. Overflow
    // remains traversable when needed; it is a cost, not a connectivity cut.
    const overflowPenalty = Number(
      this.topology.portMetadata?.[neighborPortId]
        ?.crampedPortOverflowPenalty ?? 0,
    )
    return currentCandidate.g + overflowPenalty
  }
}
