import {
  Pipeline9RegionalB01RepairSolver,
  type Pipeline9RegionalB01CandidateParams,
} from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalB01RepairSolver"
import type { ParallelRegionalB01CandidateResult, ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import { asRegionalRoutes } from "../AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9RegionalB01Repairs"

type Params = ConstructorParameters<typeof Pipeline9RegionalB01RepairSolver>[0] & {
  workerPool: ParallelStageWorkerPool
}

/** Candidates for one error share the same routes; only ordered validation commits them. */
export class ParallelPipeline9RegionalB01RepairSolver extends Pipeline9RegionalB01RepairSolver {
  readonly workerPool: ParallelStageWorkerPool
  private frontierSequence = -1
  private candidateResults: Array<{
    params: Pipeline9RegionalB01CandidateParams
    result: Promise<ParallelRegionalB01CandidateResult>
  }> = []
  private currentCandidate?: Pipeline9RegionalB01CandidateParams
  private currentResult?: ParallelRegionalB01CandidateResult

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
      const connectivityNetMap = structuredClone(params.connMap.netMap)
      for (const candidate of this.getUpcomingB01Candidates(params)) {
        const { connMap, routes, fixedObstacleRoutes, routeIndex, center, regionSize,
          srj, colorMap, viaDiameter, traceWidth, obstacleMargin, effort } = candidate
        const result = this.workerPool.run<ParallelRegionalB01CandidateResult>({
          kind: "regionalB01Candidate",
          params: { routes, fixedObstacleRoutes, routeIndex, center, regionSize,
            srj, colorMap, viaDiameter, traceWidth, obstacleMargin, effort },
          connectivityNetMap,
        }).catch((error: unknown): ParallelRegionalB01CandidateResult => ({
          kind: "regionalB01Candidate", status: "error",
          error: error instanceof Error ? error.message : String(error),
        }))
        this.candidateResults.push({ params: candidate, result })
      }
    }
    const candidate = this.candidateResults.shift()
    if (!candidate || candidate.params.routeIndex !== params.routeIndex || candidate.params.regionSize !== params.regionSize) {
      throw new Error("Parallel regional B01 candidate is missing from its frontier")
    }
    this.currentCandidate = params
    this.currentResult = undefined
    const promise = candidate.result.then((output): void => {
      if (output.kind !== "regionalB01Candidate") throw new Error("Invalid regional B01 worker output")
      this.currentResult = output
      this.pendingEffects = []
    })
    this.pendingEffects = [{ name: "parallel-regional-b01-candidate", promise }]
    this.phase = "route-b01"
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
