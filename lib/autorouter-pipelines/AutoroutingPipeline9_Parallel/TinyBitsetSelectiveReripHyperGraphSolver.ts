import type { Candidate, TinyHyperGraphTopology, TinyHyperGraphProblem, TinyHyperGraphSolver, TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { TinyBitsetCandidateScorer, type TinyBitsetScoringOptions } from "./TinyBitsetCandidateScorer"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "./TinyIndexedSelectiveReripHyperGraphSolver"
import { TinyCachedCostCongestionAwareFinalRouteSolver } from "./TinyCachedCostCongestionAwareFinalRouteSolver"
import { TinyBitsetCongestionAwareFinalRouteSolver } from "./TinyBitsetCongestionAwareFinalRouteSolver"

export class TinyBitsetSelectiveReripHyperGraphSolver extends TinyIndexedSelectiveReripHyperGraphSolver {
  private readonly bitsetScorer: TinyBitsetCandidateScorer
  private readonly cacheCompletionCosts: boolean
  private readonly prefixCompletionIntersections: boolean

  constructor(
    topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions, scoringOptions?: TinyBitsetScoringOptions,
  ) {
    super(topology, problem, options)
    this.cacheCompletionCosts = scoringOptions?.enableRegionCostCache === true
    this.prefixCompletionIntersections = scoringOptions === undefined || scoringOptions.enableStaticAnglePrefixes === true
    this.bitsetScorer = new TinyBitsetCandidateScorer(
      this, this.candidateFirstRegionByPortId, this.candidateSecondRegionByPortId,
      () => this.ADD_SEGMENT_DISTANCE_TO_G,
      (regionId, sameLayer, crossLayer, entryExitChanges, segmentCount) =>
        this.computeRegionCostForRegion(regionId, sameLayer, crossLayer, entryExitChanges, segmentCount),
      scoringOptions ?? { enableStaticAnglePrefixes: true },
    )
  }

  get bitsetCostCache(): TinyBitsetCandidateScorer["costCache"] {
    return this.bitsetScorer.costCache
  }

  get bitsetScoringDiagnostics(): TinyBitsetCandidateScorer["diagnostics"] {
    return this.bitsetScorer.diagnostics
  }

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions, attempt: number,
  ): TinyHyperGraphSolver {
    if (attempt >= 0 || (!this.cacheCompletionCosts && !this.prefixCompletionIntersections)) {
      return super.createGreedyFinalRouteSolver(options, attempt)
    }
    const completionOptions: TinyHyperGraphSolverOptions = {
      ...options, MAX_ITERATIONS: Math.max(options.MAX_ITERATIONS ?? 50_000, this.MAX_ITERATIONS * 2),
    }
    const solver = this.cacheCompletionCosts
      ? new TinyCachedCostCongestionAwareFinalRouteSolver(this.topology, this.problem, completionOptions)
      : new TinyBitsetCongestionAwareFinalRouteSolver(this.topology, this.problem, completionOptions)
    solver.remainingReripBudget = this.costAwareFinalReripBudget - this.state.ripCount
    return solver
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
