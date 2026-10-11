import { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { IntraNodeRouteSolver } from "../../solvers/HighDensitySolver/IntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../../solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { ReplayMultiHeadPolyLineSolver } from "./ReplayMultiHeadPolyLineSolver"
import type { MultiHeadHistoryDispatcher, MultiHeadHistoryJob, MultiHeadHistoryResult } from "./parallelMultiHeadHistoryTypes"
import type { FirstValidHighDensityStats, ParallelHighDensityPolicy, ParallelHighDensityPolicyOptions } from "./parallelHighDensityPolicyTypes"
import { validateFirstValidHighDensityRoutes } from "./validateFirstValidHighDensityRoutes"
import { CompletedFirstValidA13Solver } from "./CompletedFirstValidA13Solver"
import type { FirstValidA13CandidateDispatcher, FirstValidA13CandidateResult } from "./firstValidA13CandidateTypes"
import { CachedIntraNodeRouteSolver } from "../../solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { installParallelIntraNodeGridKernel } from "./installParallelHighDensityGridKernel"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { ReplayHighDensityA01Solver } from "./ReplayHighDensityA01Solver"
import { ReplayHighDensityA03Solver } from "./ReplayHighDensityA03Solver"
import type { GridHistoryDispatcher, GridHistoryJob } from "./parallelGridHistoryTypes"

type ReplayGridSolver = ReplayHighDensityA01Solver | ReplayHighDensityA03Solver

type CompletedCompetitiveCandidate =
  | { kind: "multi-head"; candidateId: number; history: MultiHeadHistoryResult }
  | { kind: "a13"; result: FirstValidA13CandidateResult }
  | { kind: "a13-error"; error: unknown }

export class ParallelPortfolioSingleIntraNodeSolver extends PortfolioSingleIntraNodeSolver {
  private readonly dispatcher: MultiHeadHistoryDispatcher
  private readonly historyCandidates = new Map<number, ReplayMultiHeadPolyLineSolver>()
  private readonly admittedCandidates = new Set<number>()
  private requestedAtExpansion = false
  private requestedAtSelection = false
  private readonly policy: ParallelHighDensityPolicy
  private readonly policyStats: FirstValidHighDensityStats
  private readonly startedAt = performance.now()
  private lastCompetitiveRequestAt = -Infinity
  private readonly completedCandidates: CompletedCompetitiveCandidate[] = []
  private nextHistoryDelivery!: Promise<void>
  private signalHistoryDelivery!: () => void
  private readonly onAcceptedCandidate?: () => void
  private readonly competitiveClearance: number
  private readonly requirePhysicalCopper: boolean
  private readonly physicalCopperObstacles?: ParallelHighDensityPolicyOptions["physicalCopperObstacles"]
  private readonly a13Dispatcher?: FirstValidA13CandidateDispatcher
  private a13Admitted = false
  private readonly gridDispatcher?: GridHistoryDispatcher
  private readonly gridCandidates = new Map<number, ReplayGridSolver>()
  private readonly admittedGridCandidates = new Set<number>()
  private lastGridRequestIteration = -Infinity

  constructor(
    params: ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0],
    dispatcher: MultiHeadHistoryDispatcher,
    options: ParallelHighDensityPolicyOptions = { policy: "ordered" },
  ) {
    // Worker node jobs publish routes and statistics, not exploratory graphics.
    // This flag only controls retained search coordinates and failed children.
    super({ ...params, captureSearchDebug: false })
    this.dispatcher = dispatcher
    this.policy = options.policy
    this.onAcceptedCandidate = options.onAcceptedCandidate
    this.competitiveClearance = options.clearance ?? 0.1
    this.requirePhysicalCopper = options.requirePhysicalCopper ?? options.policy === "first-valid"
    this.physicalCopperObstacles = options.physicalCopperObstacles
    this.a13Dispatcher = options.a13Dispatcher
    this.gridDispatcher = options.gridHistoryDispatcher
    this.policyStats = options.stats ?? { eligiblePortfolioCount: 0, acceptedCandidateCount: 0,
      rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }
    if (this.policy === "first-valid") {
      this.policyStats.eligiblePortfolioCount++
      this.resetHistoryDeliverySignal()
    }
  }

  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    if (this.requirePhysicalCopper && hyperParameters.THROUGH_OBSTACLE) {
      return new SingleTransitionThroughObstacleIntraNodeSolver({
        nodeWithPortPoints: this.nodeWithPortPoints, obstacles: this.physicalCopperObstacles
          ? [...this.physicalCopperObstacles] : this.constructorParams.obstacles,
        connMap: this.connMap, layerCount: this.constructorParams.layerCount,
        viaDiameter: this.constructorParams.viaDiameter, traceThickness: this.constructorParams.traceWidth,
        requirePhysicalCopper: true,
      }) as unknown as IntraNodeRouteSolver
    }
    if (!hyperParameters.MULTI_HEAD_POLYLINE_SOLVER) {
      const solver = super.generateSolver(hyperParameters)
      const nativeGrid: unknown = solver
      if (this.gridDispatcher && this.policy === "ordered" &&
        (nativeGrid instanceof HighDensitySolverA01 || nativeGrid instanceof HighDensitySolverA03)) {
        const replay = nativeGrid instanceof HighDensitySolverA01
          ? new ReplayHighDensityA01Solver(nativeGrid.getConstructorParams()[0])
          : new ReplayHighDensityA03Solver(nativeGrid.getConstructorParams()[0], { immutableWorkerGeometry: true })
        this.gridCandidates.set(this.gridCandidates.size, replay)
        return replay as unknown as IntraNodeRouteSolver
      }
      return solver instanceof CachedIntraNodeRouteSolver ? installParallelIntraNodeGridKernel(solver) : solver
    }
    const solver = new ReplayMultiHeadPolyLineSolver({
      nodeWithPortPoints: this.nodeWithPortPoints,
      connMap: this.connMap, hyperParameters,
      viaDiameter: this.constructorParams.viaDiameter,
    })
    this.historyCandidates.set(this.historyCandidates.size, solver)
    return solver as unknown as IntraNodeRouteSolver
  }

  async prepareForNextStep(): Promise<void> {
    if (this.solved || this.failed) return
    if (!this.supervisedSolvers) {
      this.initializeSolvers()
      // Original initialization happens inside the upcoming BaseSolver.step.
      // Its dynamic limit is affine in that parent iteration, one above this one.
      this.MAX_ITERATIONS++
      this.stats.dynamicSupervisorIterationLimit = this.MAX_ITERATIONS
    }
    if (this.policy === "first-valid") {
      await this.prepareCompetitiveStep()
      return
    }
    const selected = this.getSupervisedSolverWithBestFitness()?.solver
    const requestAtExpansion = this.adaptiveSearchExpanded && !this.requestedAtExpansion
    const requestAtSelection = selected instanceof ReplayMultiHeadPolyLineSolver && !this.requestedAtSelection
    if (requestAtExpansion || requestAtSelection) {
      this.requestedAtExpansion ||= requestAtExpansion
      this.requestedAtSelection ||= requestAtSelection
      await this.requestHistories(selected instanceof ReplayMultiHeadPolyLineSolver ? selected : undefined)
    }
    if (selected instanceof ReplayMultiHeadPolyLineSolver) await selected.prepareForNextStep()
    if (selected instanceof ReplayHighDensityA01Solver || selected instanceof ReplayHighDensityA03Solver) {
      // Almost every simple-board grid candidate ends or loses after its first
      // 100 steps. Lend workers only once the original selected candidate has
      // consumed ten quanta; retry a denied grant every sixteen supervisor steps.
      if (selected.iterations >= 1_000 && this.iterations - this.lastGridRequestIteration >= 16) {
        await this.requestGridHistories(selected)
      }
      await selected.prepareForNextStep()
    }
  }

  protected override getSolvedSegmentCount(solver: unknown): number | null {
    if (solver instanceof ReplayHighDensityA01Solver || solver instanceof ReplayHighDensityA03Solver) {
      const replayCount = solver.getReplaySolvedSegmentCount()
      if (replayCount !== null) return replayCount
    }
    return super.getSolvedSegmentCount(solver)
  }

  private async requestGridHistories(selected: ReplayGridSolver): Promise<void> {
    if (!this.gridDispatcher) throw new Error("Grid replay has no idle-worker dispatcher")
    const candidates = [...this.gridCandidates].filter(([id, solver]) =>
      !this.admittedGridCandidates.has(id) && !solver.solved && !solver.failed && solver._setupDone &&
      solver.iterations % this.MIN_SUBSTEPS === 0)
    candidates.sort((a, b) => Number(b[1] === selected) - Number(a[1] === selected))
    if (candidates.length === 0) return
    this.lastGridRequestIteration = this.iterations
    const groups: Array<Array<[number, ReplayGridSolver]>> = []
    for (const candidate of candidates) {
      const solver = candidate[1]
      const equivalent = solver instanceof ReplayHighDensityA01Solver
        ? groups.find((group) => group[0]![1] instanceof ReplayHighDensityA01Solver &&
          solver.hasEquivalentHistory(group[0]![1] as ReplayHighDensityA01Solver)) : undefined
      if (equivalent) equivalent.push(candidate)
      else groups.push([candidate])
    }
    // The three-job bound applies to physical searches. Equivalent local
    // candidates retain their own caps, parameters and replay checkpoint state.
    const selectedGroups = groups.slice(0, 3)
    const jobs: GridHistoryJob[] = selectedGroups.map((group) => group[0]![1].createHistoryJob(group[0]![0]))
    const admitted = await this.gridDispatcher(jobs)
    for (const [id, request] of admitted) {
      const group = selectedGroups.find((entry) => entry[0]![0] === id)
      const job = jobs.find((candidate) => candidate.candidateId === id)
      if (!group || !job || this.admittedGridCandidates.has(id)) throw new Error(`Grid grant names unknown or repeated candidate ${id}`)
      for (const [aliasIndex, [candidateId, solver]] of group.entries()) {
        if (this.admittedGridCandidates.has(candidateId)) throw new Error(`Grid equivalence repeats candidate ${candidateId}`)
        // Every alias is validated against its own original native prefix by
        // GridHistoryReplayState. History contains no candidate ID or seed.
        const candidateJob = aliasIndex === 0 ? job : solver.createHistoryJob(candidateId)
        solver.setHistoryRequest(candidateJob, request, (iterations): void => {
          this.gridDispatcher?.recordReplayWork?.(iterations, aliasIndex !== 0)
        })
        this.admittedGridCandidates.add(candidateId)
      }
      this.gridDispatcher.recordEquivalentCandidates?.(group.length - 1)
    }
  }

  private async requestHistories(selected?: ReplayMultiHeadPolyLineSolver): Promise<void> {
    const candidates = [...this.historyCandidates].filter(([id, solver]) =>
      !this.admittedCandidates.has(id) && solver.iterations === 0 && !solver.solved && !solver.failed)
    candidates.sort((a, b) => Number(b[1] === selected) - Number(a[1] === selected))
    if (candidates.length === 0) return
    const jobs: MultiHeadHistoryJob[] = candidates.map(([candidateId, solver]) => ({
      kind: "multiHeadHistory", candidateId,
      params: { nodeWithPortPoints: solver.nodeWithPortPoints, hyperParameters: solver.hyperParameters,
        viaDiameter: solver.viaDiameter },
      connectivityNetMap: this.connMap?.netMap ?? {},
      connectivityIdToNetMap: this.connMap?.idToNetMap ?? {},
    }))
    const admitted = await this.dispatcher(jobs)
    for (const [id, request] of admitted) {
      const solver = this.historyCandidates.get(id)
      if (!solver) throw new Error(`Multi-head grant names unknown candidate ${id}`)
      solver.setHistoryRequest(request)
      this.admittedCandidates.add(id)
      if (this.policy === "first-valid") {
        void request.then((history): void => {
          this.completedCandidates.push({ kind: "multi-head", candidateId: id, history })
          this.signalHistoryDelivery()
          this.resetHistoryDeliverySignal()
        }, (): void => {
          // The replay solver observes this rejection and throws if scheduled.
          // An unused speculative candidate never decides the winning policy.
        })
      }
    }
  }

  private resetHistoryDeliverySignal(): void {
    let signal!: () => void
    const delivery = new Promise<void>((resolve) => {
      signal = resolve
    })
    this.signalHistoryDelivery = signal
    this.nextHistoryDelivery = delivery
  }

  private acceptCompletedCompetitiveCandidate(): boolean {
    while (this.completedCandidates.length > 0) {
      const completed = this.completedCandidates.shift()!
      if (completed.kind === "a13-error") throw completed.error
      if (completed.kind === "a13") {
        if (this.acceptCompletedA13Candidate(completed.result)) return true
        continue
      }
      const terminal = completed.history.steps.at(-1) ?? completed.history.initial
      if (!terminal.solved || terminal.failed || terminal.exception) continue
      const solver = this.historyCandidates.get(completed.candidateId)
      const routeSolver = solver as unknown as IntraNodeRouteSolver
      const supervised = this.supervisedSolvers?.find((candidate) => candidate.solver === routeSolver)
      if (!solver || !supervised) throw new Error("Completed competitive history has no supervised candidate")
      solver.materializeCompletedHistory(completed.history)
      const previousRoutes = this.solvedRoutes
      this.onSolve({ ...supervised, solver: routeSolver })
      const validation = validateFirstValidHighDensityRoutes({
        routes: this.solvedRoutes, node: this.nodeWithPortPoints, connMap: this.connMap,
        traceWidth: this.constructorParams.traceWidth ?? 0.15,
        viaDiameter: this.constructorParams.viaDiameter ?? 0.3,
        obstacleMargin: this.competitiveClearance,
        layerCount: this.constructorParams.layerCount ?? 2,
        obstacles: this.constructorParams.obstacles ?? [],
        boardGeometry: this.constructorParams.boardGeometry,
      })
      if (!validation.valid) {
        this.solvedRoutes = previousRoutes
        solver.solved = false
        solver.failed = true
        solver.error = `Competitive multi-head candidate rejected: ${validation.reason}`
        this.policyStats.rejectedCandidateCount++
        this.policyStats.rejectionReasons[validation.reason] = (this.policyStats.rejectionReasons[validation.reason] ?? 0) + 1
        continue
      }
      this.winningSolver = routeSolver
      this.activeSubSolver = routeSolver
      this.solved = true
      this.failed = false
      this.error = null
      supervised.g = this.computeG(routeSolver)
      supervised.h = this.computeH(routeSolver)
      supervised.f = this.computeF(supervised.g, supervised.h)
      this.policyStats.acceptedCandidateCount++
      this.policyStats.winners.push({ nodeId: this.nodeWithPortPoints.capacityMeshNodeId,
        candidateId: completed.candidateId, candidateIterations: solver.iterations,
        elapsedTimeMs: performance.now() - this.startedAt, candidateSource: "multi-head" })
      this.onAcceptedCandidate?.()
      return true
    }
    return false
  }

  private async requestA13Candidate(): Promise<void> {
    if (!this.a13Dispatcher || this.a13Admitted) return
    const { connMap: _connMap, ...params } = this.constructorParams
    const admitted = await this.a13Dispatcher({ kind: "firstValidA13Candidate",
      params: { ...params, effort: this.effort },
      connectivityNetMap: this.connMap?.netMap ?? {},
      connectivityIdToNetMap: this.connMap?.idToNetMap ?? {},
    })
    if (!admitted) return
    this.a13Admitted = true
    void admitted.result.then((result): void => {
      this.completedCandidates.push({ kind: "a13", result })
      this.signalHistoryDelivery()
      this.resetHistoryDeliverySignal()
    }, (error: unknown): void => {
      this.completedCandidates.push({ kind: "a13-error", error })
      this.signalHistoryDelivery()
      this.resetHistoryDeliverySignal()
    })
  }

  private acceptCompletedA13Candidate(result: FirstValidA13CandidateResult): boolean {
    const work = this.policyStats.candidateWork ??= []
    work.push({ nodeId: this.nodeWithPortPoints.capacityMeshNodeId, candidateSource: "a13",
      status: result.status, iterations: result.iterations, routingIterations: result.routingIterations,
      sourceStats: result.sourceStats })
    if (result.status === "failed" || result.status === "cancelled") return false
    const solver = new CompletedFirstValidA13Solver(this.nodeWithPortPoints, result)
    const routeSolver = solver as unknown as IntraNodeRouteSolver
    const previousRoutes = this.solvedRoutes
    this.onSolve({ solver: routeSolver, hyperParameters: solver.hyperParameters, g: 0, h: 0, f: 0 })
    const validation = validateFirstValidHighDensityRoutes({
      routes: this.solvedRoutes, node: this.nodeWithPortPoints, connMap: this.connMap,
      traceWidth: this.constructorParams.traceWidth ?? 0.15,
      viaDiameter: this.constructorParams.viaDiameter ?? 0.3,
      obstacleMargin: this.competitiveClearance,
      layerCount: this.constructorParams.layerCount ?? 2,
      obstacles: this.constructorParams.obstacles ?? [],
      boardGeometry: this.constructorParams.boardGeometry,
    })
    if (!validation.valid) {
      this.solvedRoutes = previousRoutes
      this.policyStats.rejectedCandidateCount++
      this.policyStats.rejectionReasons[validation.reason] = (this.policyStats.rejectionReasons[validation.reason] ?? 0) + 1
      return false
    }
    this.winningSolver = routeSolver
    this.activeSubSolver = routeSolver
    this.solved = true
    this.failed = false
    this.error = null
    this.policyStats.acceptedCandidateCount++
    this.policyStats.winners.push({ nodeId: this.nodeWithPortPoints.capacityMeshNodeId,
      candidateId: -1, candidateIterations: result.iterations, candidateSource: "a13",
      routingIterations: result.routingIterations, sourceStats: result.sourceStats,
      elapsedTimeMs: performance.now() - this.startedAt })
    this.onAcceptedCandidate?.()
    return true
  }

  private async prepareCompetitiveStep(): Promise<void> {
    if (this.acceptCompletedCompetitiveCandidate()) return
    const selected = this.getSupervisedSolverWithBestFitness()?.solver
    const now = performance.now()
    if (now - this.lastCompetitiveRequestAt >= 50) {
      this.lastCompetitiveRequestAt = now
      await this.requestA13Candidate()
      if (this.acceptCompletedCompetitiveCandidate()) return
      await this.requestHistories(selected instanceof ReplayMultiHeadPolyLineSolver ? selected : undefined)
      if (this.acceptCompletedCompetitiveCandidate()) return
    }
    if (!(selected instanceof ReplayMultiHeadPolyLineSolver)) return
    let prepared = false
    const preparation = selected.prepareForNextStep().then((): void => { prepared = true })
    while (!prepared && !this.solved) {
      await Promise.race([preparation, this.nextHistoryDelivery])
      if (this.acceptCompletedCompetitiveCandidate()) return
    }
  }
}
