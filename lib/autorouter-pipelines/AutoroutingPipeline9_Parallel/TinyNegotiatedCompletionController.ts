import type { TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { shuffle } from "tiny-hypergraph/lib/shuffle"

export type TinyNegotiatedCompletionCandidate = {
  solved: boolean
  failed: boolean
  MAX_ITERATIONS: number
  solveAsync(): Promise<void>
}

export type TinyNegotiatedCompletionAcceptance = {
  acceptedGreedyFinalRouteOnTimeout: true
  greedyFinalRouteIter: number
  finalRoutingStrategy: "congestion-aware" | "greedy"
  greedyFinalRouteRemainingRouteCount: number
  greedyFinalRouteMaxIterations: number
}

export type TinyNegotiatedCompletionFailure = {
  greedyFinalRouteAttemptCount: number
  greedyFinalRouteRemainingRouteCount: number
  greedyFinalRouteMaxIterations: number
}

export type TinyNegotiatedCompletionAdapter<
  TSnapshot,
  TCandidate extends TinyNegotiatedCompletionCandidate,
> = {
  solverOptions: TinyHyperGraphSolverOptions
  greedyFinalRouteIters: number
  ripCount: number
  firstAttempt: -1 | 0
  getRemainingRouteIds(): number[]
  captureStartingSnapshot(): TSnapshot
  createCandidate(
    attempt: number,
    options: TinyHyperGraphSolverOptions,
  ): TCandidate
  seedCandidate(
    candidate: TCandidate,
    snapshot: TSnapshot,
    routeIds: number[],
  ): void
  accept(
    candidate: TCandidate,
    metadata: TinyNegotiatedCompletionAcceptance,
  ): void
  reportFailure(metadata: TinyNegotiatedCompletionFailure): void
}

/**
 * Runs the existing completion portfolio in its original order. A candidate
 * owns its route-level parallel work and expansion budget; this controller
 * never races a cheaper greedy attempt against the congestion-aware attempt.
 */
export class TinyNegotiatedCompletionController<
  TSnapshot,
  TCandidate extends TinyNegotiatedCompletionCandidate,
> {
  private runPromise?: Promise<boolean>

  constructor(
    private readonly adapter: TinyNegotiatedCompletionAdapter<
      TSnapshot,
      TCandidate
    >,
  ) {}

  run(): Promise<boolean> {
    if (this.runPromise !== undefined) {
      return this.runPromise
    }
    const completion = this.runAttempts()
    this.runPromise = completion
    return completion
  }

  private async runAttempts(): Promise<boolean> {
    const adapter = this.adapter
    const attemptCount = Math.max(0, Math.floor(adapter.greedyFinalRouteIters))
    if (attemptCount === 0) return false
    const remainingRouteIds = [...adapter.getRemainingRouteIds()]
    if (remainingRouteIds.length === 0) return false

    const startingSnapshot = adapter.captureStartingSnapshot()
    let maxIterations = 50_000
    for (let attempt = adapter.firstAttempt; attempt < attemptCount; attempt++) {
      const routeIds = attempt <= 0
        ? [...remainingRouteIds]
        : shuffle(remainingRouteIds, adapter.ripCount + attempt)
      const candidate = adapter.createCandidate(attempt, {
        ...adapter.solverOptions,
        ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
        GREEDY_FINAL_ROUTE_ITERS: 0,
        MAX_ITERATIONS: 50_000,
        RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
        STATIC_REACHABILITY_PRECHECK: false,
        OUTSIDE_IN_ROUTING: false,
        PARTIAL_RIP_ENABLED: false,
      })
      maxIterations = candidate.MAX_ITERATIONS
      adapter.seedCandidate(candidate, startingSnapshot, routeIds)
      await candidate.solveAsync()
      if (!candidate.solved || candidate.failed) continue

      adapter.accept(candidate, {
        acceptedGreedyFinalRouteOnTimeout: true,
        greedyFinalRouteIter: Math.max(0, attempt),
        finalRoutingStrategy: attempt < 0 ? "congestion-aware" : "greedy",
        greedyFinalRouteRemainingRouteCount: remainingRouteIds.length,
        greedyFinalRouteMaxIterations: maxIterations,
      })
      return true
    }

    adapter.reportFailure({
      greedyFinalRouteAttemptCount: attemptCount,
      greedyFinalRouteRemainingRouteCount: remainingRouteIds.length,
      greedyFinalRouteMaxIterations: maxIterations,
    })
    return false
  }
}
