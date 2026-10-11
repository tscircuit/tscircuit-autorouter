import type { Candidate, TinyHyperGraphProblem, TinyHyperGraphSolverOptions, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyBitsetCandidateScorer, type TinyBitsetScoringOptions } from "./TinyBitsetCandidateScorer"
import { CongestionAwareFinalRouteSolver } from "./tiny-hypergraph-fork/SelectiveReripTinyHyperGraphSolver"

/** Keep the native completion policy while indexing its intersection counts. */
export class TinyBitsetCongestionAwareFinalRouteSolver extends CongestionAwareFinalRouteSolver {
  private readonly scorer: TinyBitsetCandidateScorer

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions, scoringOptions?: TinyBitsetScoringOptions) {
    super(topology, problem, options)
    this.scorer = new TinyBitsetCandidateScorer(
      this, this.candidateFirstRegionByPortId, this.candidateSecondRegionByPortId,
      () => this.ADD_SEGMENT_DISTANCE_TO_G,
      (regionId, sameLayer, crossLayer, entryExitChanges, segmentCount) =>
        this.computeRegionCostForRegion(regionId, sameLayer, crossLayer, entryExitChanges, segmentCount),
      scoringOptions ?? { minimumBitsetSegmentCount: 8, enableStaticAnglePrefixes: true },
    )
  }

  get bitsetCostCache(): TinyBitsetCandidateScorer["costCache"] {
    return this.scorer.costCache
  }

  override computeG(candidate: Candidate, neighborPortId: number,
    maximumCost = Number.POSITIVE_INFINITY, knownSegmentDistance?: number): number {
    return this.scorer.computeG(candidate, neighborPortId, maximumCost, knownSegmentDistance)
  }
}
