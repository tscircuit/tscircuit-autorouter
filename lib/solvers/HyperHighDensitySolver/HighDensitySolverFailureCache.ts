type FailureCacheKey = string

type CachedFailure =
  | { kind: "iteration-limit"; iterations: number }
  | { kind: "failure"; iterations: number; error: string | null }

interface FailureCacheSolverState {
  MAX_ITERATIONS: number
  iterations: number
  solved: boolean
  failed: boolean
  error: string | null
  stats: Record<string, unknown>
}

/** Process-local, bounded cache for completed deterministic A01/A03 failures. */
export class HighDensitySolverFailureCache {
  private entries = new Map<FailureCacheKey, CachedFailure>()
  hits = 0
  misses = 0

  constructor(private readonly maxEntries = 128) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("Failure cache capacity must be a positive integer")
    }
  }

  get(key: FailureCacheKey): CachedFailure | undefined {
    const failure = this.entries.get(key)
    if (!failure) {
      this.misses++
      return undefined
    }
    this.hits++
    this.entries.delete(key)
    this.entries.set(key, failure)
    return failure
  }

  set(key: FailureCacheKey, failure: CachedFailure): void {
    this.entries.delete(key)
    this.entries.set(key, failure)
    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value
      if (oldestKey === undefined) {
        throw new Error("Nonempty failure cache has no oldest entry")
      }
      this.entries.delete(oldestKey)
    }
  }
}

export const highDensitySolverFailureCache = new HighDensitySolverFailureCache()

/** Keeps cache identity tied to the complete input and the effective budget. */
export class HighDensitySolverFailureCacheController {
  private readonly inputKey?: string
  private cacheKey?: FailureCacheKey
  private initialIterationLimit?: number
  private checkedCache = false
  private replayedFailure = false

  constructor(
    input: {
      solverName: "A01" | "A03"
      constructorParams: { initialPenaltyFn?: unknown }
    },
    private readonly cache: HighDensitySolverFailureCache,
  ) {
    // Do not round coordinates or omit search settings: nearby inputs can
    // have different routing outcomes. Nothing is persisted across processes.
    // Callbacks can depend on mutable state and cannot be identified by JSON.
    if (input.constructorParams.initialPenaltyFn === undefined) {
      this.inputKey = JSON.stringify(input)
    }
  }

  replayFailure(solver: FailureCacheSolverState): boolean {
    if (this.checkedCache || this.inputKey === undefined) return false
    this.checkedCache = true
    this.initialIterationLimit = solver.MAX_ITERATIONS
    this.cacheKey = JSON.stringify([
      this.inputKey,
      String(solver.MAX_ITERATIONS),
    ])
    const failure = this.cache.get(this.cacheKey)
    if (!failure) return false

    this.replayedFailure = true
    solver.iterations = failure.iterations
    solver.stats.failureCacheHit = true
    if (failure.kind === "failure") {
      solver.failed = true
      solver.error = failure.error
    }
    // For a budget failure, BaseSolver performs its normal final-acceptance
    // hook and reports its own iteration-limit error after _step returns.
    return true
  }

  recordFailure(solver: FailureCacheSolverState): void {
    if (!solver.failed || !this.canRecord(solver)) return
    this.cache.set(this.cacheKey!, {
      kind: "failure",
      iterations: solver.iterations,
      error: solver.error,
    })
  }

  recordIterationLimit(solver: FailureCacheSolverState): void {
    if (
      solver.solved ||
      solver.iterations < solver.MAX_ITERATIONS ||
      !this.canRecord(solver)
    ) {
      return
    }
    this.cache.set(this.cacheKey!, {
      kind: "iteration-limit",
      iterations: solver.iterations,
    })
  }

  private canRecord(solver: FailureCacheSolverState): boolean {
    return (
      !this.replayedFailure &&
      this.cacheKey !== undefined &&
      this.initialIterationLimit === solver.MAX_ITERATIONS
    )
  }
}
