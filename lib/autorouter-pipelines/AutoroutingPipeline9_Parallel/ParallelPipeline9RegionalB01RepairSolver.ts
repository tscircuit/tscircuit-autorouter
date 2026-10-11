import {
  Pipeline9RegionalB01RepairSolver,
  type Pipeline9RegionalB01CandidateParams,
  type Pipeline9RegularRegionalCandidateParams,
} from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import type { ParallelRegionalB01CandidateResult, ParallelRegionalFallbackResult, ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import { asRegionalRoutes, getPipeline9RegularRegionalCandidateOutput, preparePipeline9RegularRegionalCandidate,
  type Pipeline9RegularRegionalCandidateProblem } from "../AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"
import type { HighDensityRoute } from "../../types/high-density-types"

type Params = ConstructorParameters<typeof Pipeline9RegionalB01RepairSolver>[0] & {
  workerPool: ParallelStageWorkerPool
}

/** Candidates for one error share the same routes; only ordered validation commits them. */
export class ParallelPipeline9RegionalB01RepairSolver extends Pipeline9RegionalB01RepairSolver {
  readonly workerPool: ParallelStageWorkerPool
  private frontierSequence = -1
  private candidateResults: Array<{
    params: Pipeline9RegionalB01CandidateParams
    result?: Promise<ParallelRegionalB01CandidateResult>
  }> = []
  private frontierConnectivityNetMap: Record<string, string[]> = {}
  private frontierConnectivityIdToNetMap: Record<string, string> = {}
  private currentCandidate?: Pipeline9RegionalB01CandidateParams
  private currentResult?: ParallelRegionalB01CandidateResult
  private regularSequence = -1
  private regularProblem?: Pipeline9RegularRegionalCandidateProblem
  private regularPromise?: Promise<ParallelRegionalFallbackResult>
  private regularResult?: ParallelRegionalFallbackResult
  private regularJobsInFlight = 0

  constructor({ workerPool, ...params }: Params) {
    super(params)
    this.workerPool = workerPool
    this.pendingEffects = []
  }

  protected override startB01Candidate(params: Pipeline9RegionalB01CandidateParams): void {
    if (this.frontierSequence !== this.b01SearchSequence) {
      this.frontierSequence = this.b01SearchSequence
      this.candidateResults = []
      // Candidate preparation registers aliases for separate pieces of a net.
      // Keep that mutation in the coordinator before copying connectivity to workers.
      asRegionalRoutes(params.routes, params.connMap)
      const candidates = this.getUpcomingB01Candidates(params)
      if (this.regularJobsInFlight === 0 && this.canPrefetchRegularCandidate(candidates.length)) {
        this.queueRegularCandidate()
      }
      this.frontierConnectivityNetMap = structuredClone(params.connMap.netMap)
      this.frontierConnectivityIdToNetMap = structuredClone(params.connMap.idToNetMap)
      this.candidateResults = candidates.map((candidate) => ({ params: candidate }))
    }
    this.fillB01CandidateWindow()
    const candidate = this.candidateResults.shift()
    if (!candidate || candidate.params.routeIndex !== params.routeIndex || candidate.params.regionSize !== params.regionSize) {
      throw new Error("Parallel regional B01 candidate is missing from its frontier")
    }
    this.currentCandidate = params
    this.currentResult = undefined
    if (!candidate.result) throw new Error("Parallel regional B01 candidate was not scheduled")
    const promise = candidate.result.then((output): void => {
      if (output.kind !== "regionalB01Candidate") throw new Error("Invalid regional B01 worker output")
      this.currentResult = output
      this.pendingEffects = []
    })
    this.pendingEffects = [{ name: "parallel-regional-b01-candidate", promise }]
    this.phase = "route-b01"
  }

  private fillB01CandidateWindow(): void {
    const windowSize = Math.max(1, 4 - this.regularJobsInFlight)
    for (const candidate of this.candidateResults.slice(0, windowSize)) {
      if (candidate.result) continue
      const { routes, fixedObstacleRoutes, routeIndex, center, regionSize,
        srj, colorMap, viaDiameter, traceWidth, obstacleMargin, effort } = candidate.params
      candidate.result = this.workerPool.run<ParallelRegionalB01CandidateResult>({
        kind: "regionalB01Candidate",
        params: { routes, fixedObstacleRoutes, routeIndex, center, regionSize,
          srj, colorMap, viaDiameter, traceWidth, obstacleMargin, effort },
        connectivityNetMap: this.frontierConnectivityNetMap,
        connectivityIdToNetMap: this.frontierConnectivityIdToNetMap,
      }).catch((error: unknown): ParallelRegionalB01CandidateResult => ({
        kind: "regionalB01Candidate", status: "error",
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }

  protected override stepB01Candidate(): void {
    const result = this.currentResult
    if (!result) return
    if (result.status === "error") throw new Error(result.error)
    this.MAX_ITERATIONS += result.childStepBudget
    this.phase = result.status === "skipped" ? "prepare-b01" : "validate-b01"
    if (result.status === "skipped") {
      this.currentCandidate = undefined
      this.currentResult = undefined
    }
  }

  protected override validateB01Candidate(): void {
    const params = this.currentCandidate
    const result = this.currentResult
    if (!params || !result || result.status !== "prepared") {
      throw new Error("Parallel regional B01 has no completed candidate")
    }
    const output = result.replacement ? {
      routes: params.routes.map((route, index) => index === params.routeIndex ? result.replacement! : route),
      usedFallback: result.usedFallback,
    } : undefined
    this.currentCandidate = undefined
    this.currentResult = undefined
    this.acceptB01CandidateOutput(output)
  }

  private queueRegularCandidate(params?: Pipeline9RegularRegionalCandidateParams): void {
    this.regularSequence = this.b01SearchSequence
    this.regularProblem = undefined
    this.regularResult = undefined
    try {
      const problem = preparePipeline9RegularRegionalCandidate(params ?? this.getRegularCandidateParams())
      this.regularProblem = problem
      if (!problem) {
        this.regularPromise = Promise.resolve({ kind: "regionalFallbackSolve", status: "skipped",
          solved: false, failed: false, childStepBudget: 0 })
        return
      }
      const { connMap, ...workerParams } = problem.solver.params
      const workerPromise = this.workerPool.run<ParallelRegionalFallbackResult>({
        kind: "regionalFallbackSolve", params: workerParams,
        connectivityNetMap: structuredClone(connMap.netMap),
        connectivityIdToNetMap: structuredClone(connMap.idToNetMap),
      })
      this.regularJobsInFlight++
      this.regularPromise = workerPromise.catch((error: unknown): ParallelRegionalFallbackResult => ({
        kind: "regionalFallbackSolve", status: "error",
        error: error instanceof Error ? error.message : String(error),
      })).finally((): void => { this.regularJobsInFlight-- })
    } catch (error: unknown) {
      this.regularPromise = Promise.resolve({ kind: "regionalFallbackSolve", status: "error",
        error: error instanceof Error ? error.message : String(error) })
    }
  }

  protected override startRegularCandidate(params: Pipeline9RegularRegionalCandidateParams): void {
    // The base coordinator calls this only after its improvement and budget guards.
    if (this.regularSequence !== this.b01SearchSequence) this.queueRegularCandidate(params)
    if (!this.regularPromise) throw new Error("Parallel regional fallback has no pending result")
    const promise = this.regularPromise.then((result): void => {
      if (result.kind !== "regionalFallbackSolve") throw new Error("Invalid regional fallback worker output")
      this.regularResult = result
      this.pendingEffects = []
    })
    this.pendingEffects = [{ name: "parallel-regional-fallback", promise }]
    this.phase = "route-regional"
  }

  protected override stepRegularCandidate(): void {
    const result = this.regularResult
    if (!result) return
    if (result.status === "error") throw new Error(result.error)
    this.MAX_ITERATIONS += result.childStepBudget
    this.phase = result.status === "skipped" ? "commit-error" : "validate-regional"
    if (result.status === "skipped") {
      this.regularProblem = undefined
      this.regularPromise = undefined
      this.regularResult = undefined
    }
  }

  protected override validateRegularCandidate(): void {
    const problem = this.regularProblem
    const result = this.regularResult
    if (!problem || !result || result.status !== "prepared") {
      throw new Error("Parallel regional fallback has no completed candidate")
    }
    // Splice and validate in the coordinator using its original source sections.
    // Untouched arrays and points retain the same references as the serial helper.
    const completedSolver = Object.create(problem.solver) as typeof problem.solver
    completedSolver.solved = result.solved
    completedSolver.failed = result.failed
    completedSolver.getOutput = (): HighDensityRoute[] => {
      if (!result.routes) throw new Error("Parallel regional fallback has no solved routes")
      return result.routes
    }
    const routes = getPipeline9RegularRegionalCandidateOutput({ ...problem, solver: completedSolver })
    this.regularProblem = undefined
    this.regularPromise = undefined
    this.regularResult = undefined
    this.acceptRegularCandidateOutput(routes)
  }

  override solve(): void {
    throw new Error("Parallel regional B01 repair requires solveAsync() or awaiting pendingEffects")
  }

  async solveAsync(): Promise<void> {
    const startedAt = performance.now()
    while (!this.solved && !this.failed) {
      this.step()
      await Promise.all(this.pendingEffects!.map((effect) => effect.promise))
    }
    this.timeToSolve = performance.now() - startedAt
  }
}
