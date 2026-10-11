import { type Candidate, TinyHyperGraphSolver, type TinyHyperGraphTopology, type TinyHyperGraphProblem, type TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { TinyBitsetCandidateScorer, type TinyBitsetScoringOptions } from "./TinyBitsetCandidateScorer"

export class TinyBitsetHyperGraphSolver extends TinyHyperGraphSolver {
  private readonly bitsetScorer: TinyBitsetCandidateScorer

  constructor(
    topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions, scoringOptions?: TinyBitsetScoringOptions,
  ) {
    super(topology, problem, options)
    this.bitsetScorer = new TinyBitsetCandidateScorer(
      this, this.candidateFirstRegionByPortId, this.candidateSecondRegionByPortId,
      () => this.ADD_SEGMENT_DISTANCE_TO_G,
      (regionId, sameLayer, crossLayer, entryExitChanges, segmentCount) =>
        this.computeRegionCostForRegion(regionId, sameLayer, crossLayer, entryExitChanges, segmentCount),
      scoringOptions,
    )
  }

  get bitsetCostCache(): TinyBitsetCandidateScorer["costCache"] {
    return this.bitsetScorer.costCache
  }

  get bitsetScoringDiagnostics(): TinyBitsetCandidateScorer["diagnostics"] {
    return this.bitsetScorer.diagnostics
  }

  override computeG(
    candidate: Candidate,
    neighborPortId: number,
    maximumCost = Number.POSITIVE_INFINITY,
    knownSegmentDistance?: number,
  ): number {
    return this.bitsetScorer.computeG(candidate, neighborPortId, maximumCost, knownSegmentDistance)
  }
}
