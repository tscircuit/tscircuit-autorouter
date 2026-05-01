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

type CacheToIntraNodeSolverTransform = {
  center: { x: number; y: number }
  realToCacheConnectionName: Record<string, string>
  cacheToRealConnectionName: Record<string, string>
}

const roundCoord = (n: number) => Math.round(n * 200) / 200

const cloneValue = <T>(value: T): T =>
  typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value))

setupGlobalCaches()

const INTRA_NODE_CACHE_SCHEMA_VERSION = 3

const translateRoute = (
  route: HighDensityIntraNodeRoute,
  offset: { x: number; y: number },
  connectionNameMap: Record<string, string>,
): HighDensityIntraNodeRoute => ({
  ...route,
  connectionName:
    connectionNameMap[route.connectionName] ?? route.connectionName,
  rootConnectionName: route.rootConnectionName
    ? (connectionNameMap[route.rootConnectionName] ?? route.rootConnectionName)
    : undefined,
  route: route.route.map((point) => ({
    ...point,
    x: point.x + offset.x,
    y: point.y + offset.y,
  })),
  vias: route.vias.map((via) => ({
    ...via,
    x: via.x + offset.x,
    y: via.y + offset.y,
  })),
  jumpers: route.jumpers?.map((jumper) => ({
    ...jumper,
    start: {
      x: jumper.start.x + offset.x,
      y: jumper.start.y + offset.y,
    },
    end: {
      x: jumper.end.x + offset.x,
      y: jumper.end.y + offset.y,
    },
  })),
})

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
    const normalizedConnectionGroups = this.initialUnsolvedConnections
      .map(({ connectionName, points }) => ({
        realConnectionName: connectionName,
        points: points
          .map((point) => ({
            x: roundCoord(point.x - center.x),
            y: roundCoord(point.y - center.y),
            z: point.z ?? 0,
          }))
          .sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z),
      }))
      .sort((a, b) => {
        const aKey = JSON.stringify(a.points)
        const bKey = JSON.stringify(b.points)
        return aKey.localeCompare(bKey)
      })

    const realToCacheConnectionName = Object.fromEntries(
      normalizedConnectionGroups.map(({ realConnectionName }, index) => [
        realConnectionName,
        `conn_${index}`,
      ]),
    )
    const cacheToRealConnectionName = Object.fromEntries(
      Object.entries(realToCacheConnectionName).map(([realName, cacheName]) => [
        cacheName,
        realName,
      ]),
    )

    const normalizedConnections = normalizedConnectionGroups.map(
      ({ realConnectionName, points }) => ({
        connectionName: realToCacheConnectionName[realConnectionName],
        points: points.map((point) => ({
          connectionName: realToCacheConnectionName[realConnectionName],
          ...point,
        })),
      }),
    )

    const normalizedHyperParameters = Object.fromEntries(
      Object.entries(this.hyperParameters ?? {})
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    )

    const normalizedConnMap = this.connMap
      ? normalizedConnectionGroups.map(({ realConnectionName }) => ({
          connectionName: realToCacheConnectionName[realConnectionName],
          connectedIds: normalizedConnectionGroups
            .filter(
              ({ realConnectionName: otherConnectionName }) =>
                otherConnectionName !== realConnectionName &&
                this.connMap!.areIdsConnected(
                  realConnectionName,
                  otherConnectionName,
                ),
            )
            .map(
              ({ realConnectionName: connectedConnectionName }) =>
                realToCacheConnectionName[connectedConnectionName],
            )
            .sort(),
        }))
      : undefined

    const keyData = {
      cacheSchemaVersion: INTRA_NODE_CACHE_SCHEMA_VERSION,
      node: {
        width: roundCoord(this.nodeWithPortPoints.width),
        height: roundCoord(this.nodeWithPortPoints.height),
        availableZ: this.nodeWithPortPoints.availableZ
          ? [...this.nodeWithPortPoints.availableZ].sort()
          : undefined,
      },
      normalizedConnections,
      normalizedHyperParameters,
      minDistBetweenEnteringPoints: roundCoord(
        this.minDistBetweenEnteringPoints,
      ),
      traceWidth: roundCoord(this.traceWidth),
      viaDiameter: roundCoord(this.viaDiameter),
      obstacleMargin: roundCoord(this.obstacleMargin),
      normalizedConnMap,
    }

    const cacheKey = `intranode-solver:${objectHash(keyData)}`
    const cacheToSolveSpaceTransform: CacheToIntraNodeSolverTransform = {
      center,
      realToCacheConnectionName,
      cacheToRealConnectionName,
    }

    this.cacheKey = cacheKey
    this.cacheToSolveSpaceTransform = cacheToSolveSpaceTransform

    return { cacheKey, cacheToSolveSpaceTransform }
  }

  applyCachedSolution(cachedSolution: CachedSolvedIntraNodeRouteSolver): void {
    if (cachedSolution.success) {
      const transform =
        this.cacheToSolveSpaceTransform ??
        this.computeCacheKeyAndTransform().cacheToSolveSpaceTransform
      this.solvedRoutes = cloneValue(cachedSolution.solvedRoutes).map((route) =>
        translateRoute(
          route,
          transform.center,
          transform.cacheToRealConnectionName,
        ),
      )
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

    const transform =
      this.cacheToSolveSpaceTransform ??
      this.computeCacheKeyAndTransform().cacheToSolveSpaceTransform
    const solutionToCache: CachedSolvedIntraNodeRouteSolver = this.failed
      ? { success: false, error: this.error ?? undefined }
      : {
          success: true,
          solvedRoutes: cloneValue(this.solvedRoutes).map((route) =>
            translateRoute(
              route,
              { x: -transform.center.x, y: -transform.center.y },
              transform.realToCacheConnectionName,
            ),
          ),
        }

    try {
      this.cacheProvider.setCachedSolutionSync(this.cacheKey, solutionToCache)
    } catch (error) {
      console.error("Error saving solution to cache:", error)
    }
  }
}

export type { CachedSolvedIntraNodeRouteSolver }
