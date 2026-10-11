import { BaseSolver } from "../../solvers/BaseSolver"
import { HighDensitySolver } from "../../solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "../../types/high-density-types"
import { Pipeline9HighDensitySolver, createPipeline9RegularNodeSolver, type Pipeline9HighDensitySolverParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { ParallelPortfolioSingleIntraNodeSolver } from "./ParallelPortfolioSingleIntraNodeSolver"
import type { MultiHeadHistoryDispatcher } from "./parallelMultiHeadHistoryTypes"
import type { FirstValidHighDensityStats, ParallelHighDensityPolicy, ParallelHighDensityPolicyOptions } from "./parallelHighDensityPolicyTypes"

class ParallelGrowShrinkIntraNodeSolver extends GrowShrinkHighDensityIntraNodeSolver {
  constructor(
    params: ConstructorParameters<typeof GrowShrinkHighDensityIntraNodeSolver>[0],
    private readonly dispatcher: MultiHeadHistoryDispatcher,
    private readonly policyOptions: ParallelHighDensityPolicyOptions,
  ) {
    super(params)
  }

  protected override createPortfolioSolver(params: ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0]): PortfolioSingleIntraNodeSolver {
    const solver = new ParallelPortfolioSingleIntraNodeSolver(
      params,
      this.dispatcher,
      this.scaleFactor === 1 ? this.policyOptions : { policy: "ordered" },
    )
    return solver
  }

  prepareForNextStep(): void {
    if (this.solved || this.failed) return
    if (!this.activeSubSolver) {
      // Construct the same child before stepping ancestors, so awaiting a
      // history does not introduce additional routing or supervisor iterations.
      this.createActiveSubSolver()
    }
  }
}

function createParallelHighDensityClass(dispatcher: MultiHeadHistoryDispatcher, policyOptions: ParallelHighDensityPolicyOptions): typeof HighDensitySolver {
  return class extends HighDensitySolver {
    protected override createIntraNodeSolver(params: ConstructorParameters<typeof GrowShrinkHighDensityIntraNodeSolver>[0]): GrowShrinkHighDensityIntraNodeSolver | PortfolioSingleIntraNodeSolver {
      return this.useGrowShrinkHighDensityIntraNodeSolver
        ? new ParallelGrowShrinkIntraNodeSolver(params, dispatcher, policyOptions)
        : new ParallelPortfolioSingleIntraNodeSolver(params, dispatcher, policyOptions)
    }
  }
}

/** Ordered replay is the default; competitive physical-node acceptance is opt-in. */
export class ParallelMultiHeadHighDensityNodeSolver extends Pipeline9HighDensitySolver {
  private readonly dispatcher: MultiHeadHistoryDispatcher
  private readonly highDensityPolicy: ParallelHighDensityPolicy
  private readonly cancelUnusedHistories?: () => void
  private readonly firstValidClearance: number
  readonly firstValidStats: FirstValidHighDensityStats = { eligiblePortfolioCount: 0,
    acceptedCandidateCount: 0, rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }

  constructor(
    params: Pipeline9HighDensitySolverParams,
    dispatcher: MultiHeadHistoryDispatcher,
    highDensityPolicy: ParallelHighDensityPolicy = "ordered",
    cancelUnusedHistories?: () => void,
    firstValidClearance = 0.1,
  ) {
    super(params)
    this.dispatcher = dispatcher
    this.highDensityPolicy = highDensityPolicy
    this.cancelUnusedHistories = cancelUnusedHistories
    this.firstValidClearance = firstValidClearance
  }

  protected override createRegularNodeSolver(node: NodeWithPortPoints): HighDensitySolver {
    return createPipeline9RegularNodeSolver({
      nodeWithPortPoints: node, colorMap: this.colorMap, connMap: this.connMap,
      viaDiameter: this.viaDiameter, traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin, effort: this.effort,
      nodePfById: this.nodePfById, obstacles: this.obstacles,
      boardGeometry: this.boardGeometry, layerCount: this.layerCount,
    }, createParallelHighDensityClass(this.dispatcher, { policy: this.highDensityPolicy,
      stats: this.firstValidStats, onAcceptedCandidate: this.cancelUnusedHistories,
      clearance: this.firstValidClearance }))
  }

  async solveAsync(): Promise<void> {
    const started = Date.now()
    let lastCheckpoint = performance.now()
    while (!this.solved && !this.failed) {
      if (this.highDensityPolicy === "first-valid" && performance.now() - lastCheckpoint >= 50) {
        // A microtask-only solve loop otherwise prevents out-of-band history
        // deliveries from arriving while generic candidates consume CPU.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        lastCheckpoint = performance.now()
      }
      let cursor: BaseSolver | null | undefined = this
      while (cursor) {
        if (cursor instanceof ParallelGrowShrinkIntraNodeSolver) cursor.prepareForNextStep()
        if (cursor instanceof ParallelPortfolioSingleIntraNodeSolver) await cursor.prepareForNextStep()
        cursor = cursor.activeSubSolver
      }
      this.step()
    }
    this.timeToSolve = Date.now() - started
  }
}
