import { type Candidate, TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { TinyBitsetCandidateScorer } from "./TinyBitsetCandidateScorer"

export class TinyBitsetHyperGraphSolver extends TinyHyperGraphSolver {
  private readonly bitsetScorer = new TinyBitsetCandidateScorer(
    this, this.candidateFirstRegionByPortId, this.candidateSecondRegionByPortId,
    () => this.ADD_SEGMENT_DISTANCE_TO_G,
    (regionId, sameLayer, crossLayer, entryExitChanges, segmentCount) =>
      this.computeRegionCostForRegion(regionId, sameLayer, crossLayer, entryExitChanges, segmentCount),
  )

  override computeG(
    candidate: Candidate,
    neighborPortId: number,
    maximumCost = Number.POSITIVE_INFINITY,
    knownSegmentDistance?: number,
  ): number {
    return this.bitsetScorer.computeG(candidate, neighborPortId, maximumCost, knownSegmentDistance)
  }
}
