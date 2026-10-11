import { BaseSolver } from "../../solvers/BaseSolver"
import { HighDensitySolver } from "../../solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "../../types/high-density-types"
import { Pipeline9HighDensitySolver, createPipeline9RegularNodeSolver, type Pipeline9HighDensitySolverParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { ParallelPortfolioSingleIntraNodeSolver } from "./ParallelPortfolioSingleIntraNodeSolver"
import type { MultiHeadHistoryDispatcher } from "./parallelMultiHeadHistoryTypes"
import type { FirstValidHighDensityStats, ParallelHighDensityPolicy, ParallelHighDensityPolicyOptions } from "./parallelHighDensityPolicyTypes"
import type { FirstValidA13CandidateDispatcher } from "./firstValidA13CandidateTypes"
import { scalePhysicalCopperObstacles } from "./scalePhysicalCopperObstacles"

class ParallelGrowShrinkIntraNodeSolver extends GrowShrinkHighDensityIntraNodeSolver {
  constructor(
    params: ConstructorParameters<typeof GrowShrinkHighDensityIntraNodeSolver>[0],
    private readonly dispatcher: MultiHeadHistoryDispatcher,
    private readonly policyOptions: ParallelHighDensityPolicyOptions,
  ) {
    super(params)
  }

  protected override createPortfolioSolver(params: ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0]): PortfolioSingleIntraNodeSolver {
    const requirePhysicalCopper = this.policyOptions.requirePhysicalCopper ?? this.policyOptions.policy === "first-valid"
    const solver = new ParallelPortfolioSingleIntraNodeSolver(
      params,
      this.dispatcher,
      this.scaleFactor === 1 ? this.policyOptions : { policy: "ordered",
        requirePhysicalCopper,
        ...(requirePhysicalCopper ? { physicalCopperObstacles: scalePhysicalCopperObstacles(
          params.obstacles ?? [], this.nodeWithPortPoints.center, this.scaleFactor,
        ) } : {}),
      },
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
  private readonly a13Dispatcher?: FirstValidA13CandidateDispatcher
  private readonly cancellation?: Int32Array
  private readonly requirePhysicalCopper: boolean
  wasCancelled = false
  readonly firstValidStats: FirstValidHighDensityStats = { eligiblePortfolioCount: 0,
    acceptedCandidateCount: 0, rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }

  constructor(
    params: Pipeline9HighDensitySolverParams,
    dispatcher: MultiHeadHistoryDispatcher,
    highDensityPolicy: ParallelHighDensityPolicy = "ordered",
    cancelUnusedHistories?: () => void,
    firstValidClearance = 0.1,
    a13Dispatcher?: FirstValidA13CandidateDispatcher,
    cancellationBuffer?: SharedArrayBuffer,
    requirePhysicalCopper?: boolean,
  ) {
    super(params)
    this.dispatcher = dispatcher
    this.highDensityPolicy = highDensityPolicy
    this.cancelUnusedHistories = cancelUnusedHistories
    this.firstValidClearance = firstValidClearance
    this.a13Dispatcher = a13Dispatcher
    this.cancellation = cancellationBuffer ? new Int32Array(cancellationBuffer) : undefined
    this.requirePhysicalCopper = requirePhysicalCopper ?? highDensityPolicy === "first-valid"
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
      clearance: this.firstValidClearance, a13Dispatcher: this.a13Dispatcher,
      requirePhysicalCopper: this.requirePhysicalCopper }))
  }

  async solveAsync(): Promise<void> {
    const started = Date.now()
    let lastCheckpoint = performance.now()
    while (!this.solved && !this.failed) {
      if (this.cancellation && Atomics.load(this.cancellation, 0) !== 0) {
        this.wasCancelled = true
        break
      }
      if (this.highDensityPolicy === "first-valid" && performance.now() - lastCheckpoint >= 50) {
        // A microtask-only solve loop otherwise prevents out-of-band history
        // deliveries from arriving while generic candidates consume CPU.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        lastCheckpoint = performance.now()
      }
      let cursor: BaseSolver | null | undefined = this
      while (cursor) {
        if (cursor instanceof ParallelGrowShrinkIntraNodeSolver) cursor.prepareForNextStep()
        if (cursor instanceof ParallelPortfolioSingleIntraNodeSolver) {
          await this.preparePortfolioWithCancellation(cursor)
          if (this.wasCancelled) break
        }
        cursor = cursor.activeSubSolver
      }
      if (this.cancellation && Atomics.load(this.cancellation, 0) !== 0) this.wasCancelled = true
      if (this.wasCancelled) break
      this.step()
    }
    this.timeToSolve = Date.now() - started
  }

  private async preparePortfolioWithCancellation(portfolio: ParallelPortfolioSingleIntraNodeSolver): Promise<void> {
    const preparation = portfolio.prepareForNextStep()
    if (!this.cancellation) {
      await preparation
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancelled = new Promise<void>((resolve) => {
      const poll = (): void => {
        if (Atomics.load(this.cancellation!, 0) !== 0) {
          this.wasCancelled = true
          resolve()
          return
        }
        timer = setTimeout(poll, 50)
      }
      timer = setTimeout(poll, 50)
    })
    try {
      // The race observes a late rejected preparation even if a winning node
      // has already cancelled this unused speculative owner.
      await Promise.race([preparation, cancelled])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}
