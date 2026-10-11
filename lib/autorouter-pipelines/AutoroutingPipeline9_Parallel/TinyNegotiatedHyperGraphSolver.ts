import { getTinyHyperGraphSolverOptions, type Candidate, type TinyHyperGraphProblem, type TinyHyperGraphSolverOptions, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "./TinyIndexedSelectiveReripHyperGraphSolver"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import { createNegotiatedOccupancySnapshot, type NegotiatedPathingGraph, type NegotiatedPathingRouteJob, type NegotiatedPathingRouteResult, type NegotiatedPathSegment } from "./parallelNegotiatedPathingTypes"
import { TinyNegotiatedCompletionController } from "./TinyNegotiatedCompletionController"

type RoutingSnapshot = {
  portAssignment: Int32Array
  regionSegments: Array<[number, number, number][]>
  regionIntersectionCaches: TinyIndexedSelectiveReripHyperGraphSolver["state"]["regionIntersectionCaches"]
  regionCongestionCost: Float64Array
  ripCount: number
}
type PendingEffect = { name: string; promise: Promise<unknown> }
let nextGraphId = 0

/** Negotiated routing keeps pricing and rerips serial, but searches four routes at once. */
export class TinyNegotiatedHyperGraphSolver extends TinyIndexedSelectiveReripHyperGraphSolver {
  pendingEffects: PendingEffect[] = []
  private workerPool?: ParallelStageWorkerPool
  private graphId = ++nextGraphId
  private readonly expansionBudget: number
  private readonly expansionTickets: Int32Array
  private actualExpansions = 0
  private completionStarted = false
  private isCompletionCandidate = false
  private mode: "cost-aware" | "greedy" = "cost-aware"
  private remainingCompletionReripBudget?: number
  readonly negotiatedStats = { batches: 0, routeSearches: 0, searchExpansions: 0,
    speculativeDiscardedExpansions: 0, staleRouteConflicts: 0, committedRoutes: 0,
    completionSearchExpansions: 0 }

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, options?: TinyHyperGraphSolverOptions) {
    super(topology, problem, options)
    this.expansionBudget = this.MAX_ITERATIONS
    if (!Number.isSafeInteger(this.expansionBudget) || this.expansionBudget < 1 || this.expansionBudget > 2_147_483_647) {
      throw new Error("Negotiated pathing requires a positive integer expansion budget")
    }
    this.expansionTickets = new Int32Array(new SharedArrayBuffer(4))
    Atomics.store(this.expansionTickets, 0, this.expansionBudget)
  }

  configureWorkerPool(workerPool: ParallelStageWorkerPool): void {
    if (this.workerPool && this.workerPool !== workerPool) throw new Error("Negotiated pathing worker pool changed during a solve")
    this.workerPool = workerPool
  }

  override solve(): void {
    throw new Error("Negotiated pathing requires solveAsync() or awaiting pendingEffects")
  }

  async solveAsync(): Promise<void> {
    while (!this.solved && !this.failed) {
      this.step()
      if (this.pendingEffects.length > 0) await Promise.all(this.pendingEffects.map((effect) => effect.promise))
    }
  }

  override _step(): void {
    if (!this.workerPool) throw new Error("Negotiated pathing requires a worker pool before its first route step")
    // Public step calls schedule batches rather than individual expansions.
    // The finite original budget is enforced by shared worker tickets instead.
    this.MAX_ITERATIONS = Number.POSITIVE_INFINITY
    if (this.pendingEffects.length > 0) return
    if (this.state.currentRouteId !== undefined) throw new Error("Negotiated coordinator retained a partially expanded route")
    if (this.state.unroutedRoutes.length === 0) {
      this.onAllRoutesRouted()
      this.publishNegotiatedStats()
      return
    }
    if (this.actualExpansions >= this.expansionBudget) {
      this.beginFinalAcceptance()
      return
    }
    const remainingBudget = this.expansionBudget - this.actualExpansions
    const routeIds = this.state.unroutedRoutes.slice(0, Math.min(4, remainingBudget))
    const snapshot = createNegotiatedOccupancySnapshot(this)
    const options = getTinyHyperGraphSolverOptions(this)
    const graph: NegotiatedPathingGraph = { topology: this.topology, problem: this.problem }
    const promises = routeIds.map((routeId): Promise<NegotiatedPathingRouteResult> => {
      this.routeAttemptCountByRouteId[routeId]!++
      const job: NegotiatedPathingRouteJob = { kind: "pathingNegotiatedRoute", graphId: this.graphId,
        graph, snapshot, routeId, routePlan: this.partialRipRoutePlans.get(routeId), mode: this.mode,
        expansionTickets: this.expansionTickets, options: { ...options, MAX_ITERATIONS: this.expansionBudget } }
      return this.workerPool!.run<NegotiatedPathingRouteResult>(job)
    })
    this.negotiatedStats.batches++
    this.negotiatedStats.routeSearches += routeIds.length
    const promise = Promise.all(promises).then((results): void => {
      this.pendingEffects = []
      this.consumeBatch(routeIds, results)
    }).catch((error: unknown): never => {
      this.pendingEffects = []
      this.failed = true
      this.MAX_ITERATIONS = this.expansionBudget
      this.error = error instanceof Error ? error.message : String(error)
      throw error
    })
    this.pendingEffects = [{ name: "parallel-negotiated-pathing", promise }]
  }

  private consumeBatch(routeIds: number[], results: NegotiatedPathingRouteResult[]): void {
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!
      if (result.kind !== "pathingNegotiatedRoute" || result.routeId !== routeIds[index] ||
          !Number.isSafeInteger(result.expansions) || result.expansions < 0 ||
          !["solved", "exhausted", "budget"].includes(result.status) ||
          (result.status === "solved" && !Array.isArray(result.segments))) {
        throw new Error("Negotiated pathing worker returned an invalid route result")
      }
      this.actualExpansions += result.expansions
      this.negotiatedStats.searchExpansions += result.expansions
    }
    if (this.actualExpansions + Atomics.load(this.expansionTickets, 0) !== this.expansionBudget) {
      throw new Error("Negotiated pathing worker expansion accounting disagrees with the shared budget")
    }
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!
      if (this.state.unroutedRoutes[0] !== result.routeId) throw new Error("Negotiated route commit order changed unexpectedly")
      this.state.currentRouteId = result.routeId
      this.state.currentRouteNetId = this.problem.routeNet[result.routeId]!
      this.state.goalPortId = this.getRouteEndPortId(result.routeId)
      if (result.status === "solved") {
        const valid = this.validateCandidatePath(result.routeId, result.segments)
        if (!valid) {
          this.negotiatedStats.staleRouteConflicts++
          this.state.currentRouteId = undefined
          this.state.currentRouteNetId = undefined
          this.discardRemainingResults(results, index)
          break
        }
        this.state.unroutedRoutes.shift()
        this.commitCandidatePath(result.routeId, result.segments)
        continue
      }
      if (result.status === "exhausted") {
        this.state.unroutedRoutes.shift()
        this.onOutOfCandidates()
        this.discardRemainingResults(results, index + 1)
        break
      }
      this.state.currentRouteId = undefined
      this.state.currentRouteNetId = undefined
      this.discardRemainingResults(results, index)
      break
    }
    this.publishNegotiatedStats()
    if (!this.failed && this.state.unroutedRoutes.length === 0) this.onAllRoutesRouted()
    // A completed batch may exhaust the original budget. Completion is an
    // awaited phase rather than an unresolved BaseSolver final-acceptance hook.
    if (!this.solved && !this.failed && this.actualExpansions >= this.expansionBudget) {
      this.beginFinalAcceptance()
    }
  }

  private discardRemainingResults(results: NegotiatedPathingRouteResult[], start: number): void {
    for (let index = start; index < results.length; index++) {
      this.negotiatedStats.speculativeDiscardedExpansions += results[index]!.expansions
    }
  }

  private validateCandidatePath(routeId: number, segments: NegotiatedPathSegment[]): boolean {
    let cursor = this.getRouteStartPortId(routeId)
    const routeNet = this.problem.routeNet[routeId]!
    let liveConflict = false
    for (const segment of segments) {
      if (!Number.isInteger(segment.regionId) || segment.regionId < 0 || segment.regionId >= this.topology.regionCount ||
          segment.fromPortId !== cursor || !Number.isInteger(segment.toPortId) ||
          segment.toPortId < 0 || segment.toPortId >= this.topology.portCount ||
          !this.topology.incidentPortRegion[segment.fromPortId]?.includes(segment.regionId) ||
          !this.topology.incidentPortRegion[segment.toPortId]?.includes(segment.regionId)) {
        throw new Error(`Negotiated route ${routeId} returned disconnected or non-incident segments`)
      }
      for (const portId of [segment.fromPortId, segment.toPortId]) {
        if (this.isPortReservedForDifferentNet(portId)) throw new Error(`Negotiated route ${routeId} crossed a reserved endpoint ${portId}`)
        const assignedNet = this.state.portAssignment[portId]!
        if (assignedNet !== -1 && assignedNet !== routeNet) liveConflict = true
      }
      if (this.isRegionReservedForDifferentNet(segment.regionId)) throw new Error(`Negotiated route ${routeId} crossed a reserved region`)
      if (this.mode === "cost-aware") {
        const candidate: Candidate = { portId: segment.fromPortId, nextRegionId: segment.regionId, f: 0, g: 0, h: 0 }
        if (!Number.isFinite(this.computeG(candidate, segment.toPortId))) liveConflict = true
      }
      cursor = segment.toPortId
    }
    if (cursor !== this.getRouteEndPortId(routeId)) throw new Error(`Negotiated route ${routeId} did not reach its active endpoint`)
    return !liveConflict
  }

  private commitCandidatePath(routeId: number, segments: NegotiatedPathSegment[]): void {
    const routeNet = this.problem.routeNet[routeId]!
    for (const { regionId, fromPortId, toPortId } of segments) {
      this.state.regionSegments[regionId]!.push([routeId, fromPortId, toPortId])
      this.state.portAssignment[fromPortId] = routeNet
      this.state.portAssignment[toPortId] = routeNet
      this.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    }
    this.routeSuccessCountByRouteId[routeId]!++
    this.partialRipRoutePlans.delete(routeId)
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.candidateQueue.clear()
    this.negotiatedStats.committedRoutes++
  }

  override onOutOfCandidates(): void {
    super.onOutOfCandidates()
    if (this.remainingCompletionReripBudget !== undefined && this.state.ripCount >= this.remainingCompletionReripBudget) {
      this.failed = true
      this.error = "Congestion-aware final routing exhausted its rerip budget"
    }
  }

  private beginFinalAcceptance(): void {
    if (this.completionStarted) throw new Error("Negotiated pathing attempted to start completion twice")
    this.completionStarted = true
    if (this.ACCEPT_BEST_SOLUTION_ON_TIMEOUT && this.bestSolvedStateSnapshot && this.bestSolvedStateSummary) {
      this.restoreBestSolvedState()
      this.solved = true
      this.stats = { ...this.stats, acceptedBestSolutionOnTimeout: true,
        maxRegionCost: this.bestSolvedStateSummary.maxRegionCost, totalRegionCost: this.bestSolvedStateSummary.totalRegionCost }
      this.publishNegotiatedStats()
      return
    }
    if (this.isCompletionCandidate || !this.ACCEPT_BEST_SOLUTION_ON_TIMEOUT || this.GREEDY_FINAL_ROUTE_ITERS <= 0) {
      this.failed = true
      this.error = `${this.getSolverName()} exhausted its expansion budget (${this.expansionBudget})`
      this.publishNegotiatedStats()
      return
    }
    const capturedOptions = getTinyHyperGraphSolverOptions(this)
    const originalMaxIterations = this.expansionBudget
    // BaseSolver's terminal check cannot represent an awaited completion effect.
    // All searches continue to use explicit, finite original expansion budgets.
    this.MAX_ITERATIONS = Number.POSITIVE_INFINITY
    const candidates: TinyNegotiatedHyperGraphSolver[] = []
    const controller = new TinyNegotiatedCompletionController<RoutingSnapshot, TinyNegotiatedHyperGraphSolver>({
      solverOptions: capturedOptions, greedyFinalRouteIters: this.GREEDY_FINAL_ROUTE_ITERS,
      ripCount: this.state.ripCount, firstAttempt: this.state.ripCount < this.costAwareFinalReripBudget ? -1 : 0,
      getRemainingRouteIds: (): number[] => this.getRemainingRouteIdsForGreedyFinalRoute(),
      captureStartingSnapshot: (): RoutingSnapshot => ({ portAssignment: this.state.portAssignment,
        regionSegments: this.state.regionSegments, regionIntersectionCaches: this.state.regionIntersectionCaches,
        regionCongestionCost: this.state.regionCongestionCost, ripCount: this.state.ripCount }),
      createCandidate: (attempt, options): TinyNegotiatedHyperGraphSolver => {
        const solver = new TinyNegotiatedHyperGraphSolver(this.topology, this.problem, attempt < 0
          ? { ...options, MAX_ITERATIONS: Math.max(options.MAX_ITERATIONS ?? 50_000, this.expansionBudget * 2) } : options)
        solver.configureWorkerPool(this.workerPool!)
        solver.graphId = this.graphId
        solver.isCompletionCandidate = true
        solver.mode = attempt < 0 ? "cost-aware" : "greedy"
        if (attempt < 0) solver.remainingCompletionReripBudget = this.costAwareFinalReripBudget - this.state.ripCount
        candidates.push(solver)
        return solver
      },
      seedCandidate: (solver, snapshot, routeIds): void => this.applySnapshotToGreedyFinalRouteSolver(solver, snapshot, routeIds),
      accept: (solver, metadata): void => {
        this.bestSolvedStateSnapshot = { portAssignment: solver.state.portAssignment,
          regionSegments: solver.state.regionSegments, regionIntersectionCaches: solver.state.regionIntersectionCaches,
          regionCongestionCost: solver.state.regionCongestionCost, ripCount: solver.state.ripCount }
        this.bestSolvedStateSummary = this.summarizeSolvedState(solver)
        this.restoreBestSolvedState()
        this.solved = true
        this.failed = false
        this.error = null
        this.stats = { ...this.stats, ...metadata, acceptedGreedyFinalRouteOnTimeout: true,
          neverSuccessfullyRoutedRouteCount: 0, maxRegionCost: this.bestSolvedStateSummary.maxRegionCost,
          totalRegionCost: this.bestSolvedStateSummary.totalRegionCost }
      },
      reportFailure: (metadata): void => { this.stats = { ...this.stats, ...metadata } },
    })
    const promise = controller.run().then((accepted): void => {
      this.negotiatedStats.completionSearchExpansions = candidates.reduce((sum, candidate) =>
        sum + candidate.negotiatedStats.searchExpansions, 0)
      this.MAX_ITERATIONS = originalMaxIterations
      this.pendingEffects = []
      if (!accepted) {
        this.failed = true
        this.error = "Negotiated pathing exhausted every original completion candidate"
      }
      this.publishNegotiatedStats()
    }).catch((error: unknown): never => {
      this.MAX_ITERATIONS = originalMaxIterations
      this.pendingEffects = []
      this.failed = true
      this.error = error instanceof Error ? error.message : String(error)
      throw error
    })
    this.pendingEffects = [{ name: "parallel-negotiated-completion", promise }]
  }

  private publishNegotiatedStats(): void {
    if (this.solved || this.failed) this.MAX_ITERATIONS = this.expansionBudget
    this.stats = { ...this.stats, negotiatedPathing: { ...this.negotiatedStats, expansionBudget: this.expansionBudget } }
  }
}
