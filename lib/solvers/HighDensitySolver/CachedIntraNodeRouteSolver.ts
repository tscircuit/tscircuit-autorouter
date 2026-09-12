import { computeIntraNodeCacheKey } from "lib/cache/computeIntraNodeCacheKey"

import {
  getGlobalInMemoryCache,
  setupGlobalCaches,
} from "lib/cache/setupGlobalCaches"
import { CachableSolver, CacheProvider } from "lib/cache/types"
import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"

import { IntraNodeRouteSolver } from "./IntraNodeSolver"

type CachedSolvedIntraNodeRouteSolver =
  | { success: true; solvedRoutes: HighDensityIntraNodeRoute[] }
  | { success: false; error?: string }

type CacheToIntraNodeSolverTransform = Record<string, never>

const cloneValue = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value))

setupGlobalCaches()

export class CachedIntraNodeRouteSolver
  extends IntraNodeRouteSolver
  implements
    CachableSolver<
      CacheToIntraNodeSolverTransform,
      CachedSolvedIntraNodeRouteSolver
    >
{
  override getSolverName(): string {
    return "CachedIntraNodeRouteSolver"
  }

  cacheProvider: CacheProvider | null
  cacheHit = false
  hasAttemptedToUseCache = false
  declare cacheKey?: string | undefined
  declare cacheToSolveSpaceTransform?:
    | CacheToIntraNodeSolverTransform
    | undefined
  initialUnsolvedConnections: {
    connectionName: string
    rootConnectionName?: string
    points: { x: number; y: number; z: number }[]
  }[]

  constructor(
    params: ConstructorParameters<typeof IntraNodeRouteSolver>[0] & {
      cacheProvider?: CacheProvider | null
    },
    sharedProps: object = params,
  ) {
    super(params, sharedProps)
    this.cacheProvider =
      params.cacheProvider === undefined
        ? getGlobalInMemoryCache()
        : params.cacheProvider
    this.initialUnsolvedConnections = cloneValue(
      this.getInitialUnsolvedConnections(),
    )

    if ((this.solved || this.failed) && this.cacheProvider && !this.cacheHit) {
      this.saveToCacheSync()
    }
  }

  _step(): void {
    if (!this.hasAttemptedToUseCache && this.cacheProvider) {
      if (this.attemptToUseCacheSync()) {
        return
      }
    }

    const wasSolved = this.solved
    const wasFailed = this.failed

    this.stepUncached()

    if (
      this.cacheProvider &&
      !this.cacheHit &&
      (this.solved || this.failed) &&
      !(wasSolved || wasFailed)
    ) {
      this.saveToCacheSync()
    }
  }

  protected stepUncached(): void {
    super._step()
  }

  computeCacheKeyAndTransform(): {
    cacheKey: string
    cacheToSolveSpaceTransform: CacheToIntraNodeSolverTransform
  } {
    const cacheKey = computeIntraNodeCacheKey(this)
    const cacheToSolveSpaceTransform: CacheToIntraNodeSolverTransform = {}

    this.cacheKey = cacheKey
    this.cacheToSolveSpaceTransform = cacheToSolveSpaceTransform

    return { cacheKey, cacheToSolveSpaceTransform }
  }

  applyCachedSolution(cachedSolution: CachedSolvedIntraNodeRouteSolver): void {
    if (cachedSolution.success) {
      this.solvedRoutes = cloneValue(cachedSolution.solvedRoutes)
      this.solved = true
      this.failed = false
    } else {
      this.solvedRoutes = []
      this.failedSubSolvers = []
      this.solved = false
      this.failed = true
      this.error = cachedSolution.error ?? this.error
    }
    this.unsolvedConnections = []
    this.activeSubSolver = null
    this.cacheHit = true
    this.progress = 1
  }

  attemptToUseCacheSync(): boolean {
    this.hasAttemptedToUseCache = true
    if (!this.cacheProvider?.isSyncCache) {
      return false
    }

    if (!this.cacheKey) {
      try {
        this.computeCacheKeyAndTransform()
      } catch (error) {
        console.error("Error computing cache key:", error)
        return false
      }
    }

    if (!this.cacheKey) {
      console.error("Failed to compute cache key.")
      return false
    }

    try {
      const cachedSolution = this.cacheProvider.getCachedSolutionSync(
        this.cacheKey,
      )

      if (cachedSolution !== undefined && cachedSolution !== null) {
        this.applyCachedSolution(cachedSolution)
        return true
      }
    } catch (error) {
      console.error("Error attempting to use cache:", error)
    }

    return false
  }

  saveToCacheSync(): void {
    if (!this.cacheProvider?.isSyncCache) {
      return
    }

    if (!this.cacheKey) {
      try {
        this.computeCacheKeyAndTransform()
      } catch (error) {
        console.error("Error computing cache key during save:", error)
        return
      }
    }

    if (!this.cacheKey) {
      console.error("Failed to compute cache key before saving.")
      return
    }

    const solutionToCache: CachedSolvedIntraNodeRouteSolver = this.failed
      ? { success: false, error: this.error ?? undefined }
      : { success: true, solvedRoutes: cloneValue(this.solvedRoutes) }

    try {
      this.cacheProvider.setCachedSolutionSync(this.cacheKey, solutionToCache)
    } catch (error) {
      console.error("Error saving solution to cache:", error)
    }
  }
}

export type { CachedSolvedIntraNodeRouteSolver }
