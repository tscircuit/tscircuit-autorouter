import type { TinyHyperGraphProblem, TinyHyperGraphSolver, TinyHyperGraphSolverOptions, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "./TinyIndexedSelectiveReripHyperGraphSolver"
import { TinyGoalBallHeuristic } from "./TinyGoalBallHeuristic"
import type { ParallelGoalBallWorkerPool } from "./parallelGoalBallWorkerTypes"

export class TinyGoalBallSelectiveReripHyperGraphSolver extends TinyIndexedSelectiveReripHyperGraphSolver {
  readonly goalBallHeuristic: TinyGoalBallHeuristic
  private cachedRouteId?: number
  private cachedTargetPortId?: number
  private cachedBounds?: Float64Array
  private preparedRouteId?: number
  private preparedTargetPortId?: number
  private preparedStartPortId?: number
  protected useGoalBallBounds = false

  get goalBallScoresGeometricSegments(): boolean {
    return this.ADD_SEGMENT_DISTANCE_TO_G
  }

  get needsCompletionGoalPreparation(): boolean {
    return !this.useGoalBallBounds && !this.goalBallHeuristic.ready &&
      this.iterations + 1 >= this.MAX_ITERATIONS
  }

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions, heuristic?: TinyGoalBallHeuristic) {
    super(topology, problem, options)
    this.goalBallHeuristic = heuristic ?? new TinyGoalBallHeuristic(this)
    if (heuristic) heuristic.validateSolver(this)
  }

  prepareNextGoal(workerPool?: ParallelGoalBallWorkerPool): Promise<void> | undefined {
    const routeId = this.state.currentRouteId ?? this.state.unroutedRoutes[0]
    if (routeId === undefined) return undefined
    const target = this.getRouteEndPortId(routeId)
    const start = this.getRouteStartPortId(routeId)
    if (this.preparedRouteId === routeId && this.preparedTargetPortId === target && this.preparedStartPortId === start) {
      return undefined
    }
    const pending = this.goalBallHeuristic.ensureGoal(this.problem.routeNet[routeId]!, target,
      start, workerPool)
    const record = (): void => {
      this.preparedRouteId = routeId
      this.preparedTargetPortId = target
      this.preparedStartPortId = start
      this.cachedRouteId = undefined
      this.cachedBounds = undefined
    }
    if (pending) return pending.then(record)
    record()
    return pending
  }

  override computeH(portId: number): number {
    const routeId = this.state.currentRouteId
    if (routeId === undefined) throw new Error("Goal-ball route heuristic requires an active route")
    const target = this.getRouteEndPortId(routeId)
    const landmark = this.goalBallHeuristic.landmarkHeuristic.lowerBound(portId, target)
    if (!this.useGoalBallBounds) return Math.max(super.computeH(portId), landmark)
    if (this.cachedRouteId !== routeId || this.cachedTargetPortId !== target || !this.cachedBounds) {
      this.cachedRouteId = routeId
      this.cachedTargetPortId = target
      this.cachedBounds = this.goalBallHeuristic.getBounds(this.problem.routeNet[routeId]!, target)
    }
    return Math.max(super.computeH(portId), this.cachedBounds[portId]!, landmark)
  }

  override _step(): void {
    if (!this.goalBallHeuristic.landmarkHeuristic.ready) this.goalBallHeuristic.prepareLandmarks()
    // Standalone and synchronous completion calls still prepare temporary
    // partial-rip targets before their first candidate expansion.
    if (this.useGoalBallBounds) {
      if (!this.goalBallHeuristic.ready) this.goalBallHeuristic.prepareSync()
      if (this.prepareNextGoal()) throw new Error("Goal-ball routing advanced while target preparation was pending")
    }
    super._step()
  }

  override tryFinalAcceptance(): void {
    // The outer adapter performs this prephase asynchronously before the last
    // ordinary step. Standalone callers retain the same completion semantics.
    if (!this.goalBallHeuristic.ready) this.goalBallHeuristic.prepareSync()
    super.tryFinalAcceptance()
  }

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions, attempt: number,
  ): TinyHyperGraphSolver {
    if (attempt >= 0) return super.createGreedyFinalRouteSolver(options, attempt)
    const solver = new GoalBallCongestionAwareFinalRouteSolver(this.topology, this.problem, {
      ...options, MAX_ITERATIONS: Math.max(options.MAX_ITERATIONS ?? 50_000, this.MAX_ITERATIONS * 2),
    }, this.goalBallHeuristic)
    solver.remainingReripBudget = this.costAwareFinalReripBudget - this.state.ripCount
    return solver
  }
}

class GoalBallCongestionAwareFinalRouteSolver extends TinyGoalBallSelectiveReripHyperGraphSolver {
  remainingReripBudget = 0
  protected override useGoalBallBounds = true

  override onOutOfCandidates(): void {
    super.onOutOfCandidates()
    if (this.state.ripCount >= this.remainingReripBudget) {
      this.failed = true
      this.error = "Congestion-aware final routing exhausted its rerip budget"
    }
  }
}
