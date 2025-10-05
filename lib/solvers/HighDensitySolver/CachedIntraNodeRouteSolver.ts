import objectHash from "object-hash"

import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"
import {
  getGlobalInMemoryCache,
  setupGlobalCaches,
} from "lib/cache/setupGlobalCaches"
import { CachableSolver, CacheProvider } from "lib/cache/types"

import { IntraNodeRouteSolver } from "./IntraNodeSolver"

type CachedSolvedIntraNodeRouteSolver =
  | { success: true; solvedRoutes: HighDensityIntraNodeRoute[] }
  | { success: false; error?: string }

type CacheToIntraNodeSolverTransform = Record<string, never>

const roundCoord = (n: number) => Math.round(n * 200) / 200

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
  cacheProvider: CacheProvider | null
  cacheHit = false
  hasAttemptedToUseCache = false
  declare cacheKey?: string | undefined
  declare cacheToSolveSpaceTransform?:
    | CacheToIntraNodeSolverTransform
    | undefined
  initialUnsolvedConnections: {
    connectionName: string
    points: { x: number; y: number; z: number }[]
  }[]

  constructor(
    params: ConstructorParameters<typeof IntraNodeRouteSolver>[0] & {
      cacheProvider?: CacheProvider | null
    },
  ) {
    super(params)
    this.cacheProvider =
      params.cacheProvider === undefined
        ? getGlobalInMemoryCache()
        : params.cacheProvider
    this.initialUnsolvedConnections = cloneValue(this.unsolvedConnections)

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

    super._step()

    if (
      this.cacheProvider &&
      !this.cacheHit &&
      (this.solved || this.failed) &&
      !(wasSolved || wasFailed)
    ) {
      this.saveToCacheSync()
    }
  }

  computeCacheKeyAndTransform(): {
    cacheKey: string
    cacheToSolveSpaceTransform: CacheToIntraNodeSolverTransform
  } {
    const center = this.nodeWithPortPoints.center
    const normalizedConnections = this.initialUnsolvedConnections.map(
      ({ connectionName, points }) => ({
        connectionName,
        points: points.map((point) => ({
          connectionName,
          x: roundCoord(point.x - center.x),
          y: roundCoord(point.y - center.y),
          z: point.z ?? 0,
        })),
      }),
    )

    const normalizedHyperParameters = Object.fromEntries(
      Object.entries(this.hyperParameters ?? {})
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    )

    const normalizedConnMap = this.connMap
      ? this.initialUnsolvedConnections.map(({ connectionName }) => ({
          connectionName,
          connectedIds: [
            ...new Set(
              this.connMap!.getIdsConnectedToNet(connectionName) ?? [],
            ),
          ].sort(),
        }))
      : undefined

    const keyData = {
      node: {
        width: roundCoord(this.nodeWithPortPoints.width),
        height: roundCoord(this.nodeWithPortPoints.height),
        center: {
          x: roundCoord(this.nodeWithPortPoints.center.x),
          y: roundCoord(this.nodeWithPortPoints.center.y),
        },
        availableZ: this.nodeWithPortPoints.availableZ
          ? [...this.nodeWithPortPoints.availableZ].sort()
          : undefined,
      },
      normalizedConnections,
      normalizedHyperParameters,
      minDistBetweenEnteringPoints: roundCoord(
        this.minDistBetweenEnteringPoints,
      ),
      normalizedConnMap,
    }

    const cacheKey = `intranode-solver:${objectHash(keyData)}`
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
