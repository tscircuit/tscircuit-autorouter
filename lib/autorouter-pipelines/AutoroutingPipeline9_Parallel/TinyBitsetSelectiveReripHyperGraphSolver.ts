import type { Candidate } from "tiny-hypergraph/lib/core"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { TinyBitsetCandidateScorer } from "./TinyBitsetCandidateScorer"

export class TinyBitsetSelectiveReripHyperGraphSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
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
