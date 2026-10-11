import { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { IntraNodeRouteSolver } from "../../solvers/HighDensitySolver/IntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "../../solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import { ReplayMultiHeadPolyLineSolver } from "./ReplayMultiHeadPolyLineSolver"
import type { MultiHeadHistoryDispatcher, MultiHeadHistoryJob, MultiHeadHistoryResult } from "./parallelMultiHeadHistoryTypes"
import type { FirstValidHighDensityStats, ParallelHighDensityPolicy, ParallelHighDensityPolicyOptions } from "./parallelHighDensityPolicyTypes"
import { validateFirstValidHighDensityRoutes } from "./validateFirstValidHighDensityRoutes"
import { CompletedFirstValidA13Solver } from "./CompletedFirstValidA13Solver"
import type { FirstValidA13CandidateDispatcher, FirstValidA13CandidateResult } from "./firstValidA13CandidateTypes"

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

  constructor(
    params: ConstructorParameters<typeof PortfolioSingleIntraNodeSolver>[0],
    dispatcher: MultiHeadHistoryDispatcher,
    options: ParallelHighDensityPolicyOptions = { policy: "ordered" },
  ) {
    super(params)
    this.dispatcher = dispatcher
    this.policy = options.policy
    this.onAcceptedCandidate = options.onAcceptedCandidate
    this.competitiveClearance = options.clearance ?? 0.1
    this.requirePhysicalCopper = options.requirePhysicalCopper ?? options.policy === "first-valid"
    this.physicalCopperObstacles = options.physicalCopperObstacles
    this.a13Dispatcher = options.a13Dispatcher
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
    if (!hyperParameters.MULTI_HEAD_POLYLINE_SOLVER) return super.generateSolver(hyperParameters)
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
