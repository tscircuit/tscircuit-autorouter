import { CachableSolver, CacheProvider } from "lib/cache/types"
import {
  getGlobalInMemoryCache,
  setupGlobalCaches,
} from "lib/cache/setupGlobalCaches"
import { HyperSingleIntraNodeSolver } from "./HyperSingleIntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { HighDensityHyperParameters } from "../HighDensitySolver/HighDensityHyperParameters"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import objectHash from "object-hash"

// Define the structure of the cached data
type CachedSolvedHyperSingleIntraNode =
  | { success: true; solvedRoutes: HighDensityIntraNodeRoute[] }
  | { success: false }

type CacheToHyperSingleIntraNodeTransform = {
  center: { x: number; y: number }
  realToCacheConnectionName: Record<string, string>
  cacheToRealConnectionName: Record<string, string>
}

// Round coordinates to mitigate floating point inconsistencies in cache keys

// Round to nearest 5um (0.005mm)
const roundCoord = (n: number) => Math.round(n * 200) / 200

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

setupGlobalCaches()

export class CachedHyperSingleIntraNodeSolver
  extends HyperSingleIntraNodeSolver
  implements
    CachableSolver<
      CacheToHyperSingleIntraNodeTransform,
      CachedSolvedHyperSingleIntraNode
    >
{
  cacheHit = false
  cacheProvider: CacheProvider | null
  declare cacheKey?: string | undefined
  declare cacheToSolveSpaceTransform?:
    | CacheToHyperSingleIntraNodeTransform
    | undefined
  hasAttemptedToUseCache = false

  constructor(
    params: ConstructorParameters<typeof HyperSingleIntraNodeSolver>[0] & {
      cacheProvider?: CacheProvider | null
    },
  ) {
    super(params)
    this.cacheProvider =
      params.cacheProvider === undefined
        ? getGlobalInMemoryCache() // Default to in-memory if undefined
        : params.cacheProvider // Use null if explicitly passed as null
  }

  _step(): void {
    if (!this.hasAttemptedToUseCache && this.cacheProvider) {
      if (this.attemptToUseCacheSync()) {
        // If cache hit and applied, we might be done or failed based on cache
        return
      }
    }
    super._step()
    if ((this.solved || this.failed) && this.cacheProvider && !this.cacheHit) {
      // Save to cache only if it wasn't a cache hit initially
      this.saveToCacheSync()
    }
  }

  computeCacheKeyAndTransform(): {
    cacheKey: string
    cacheToSolveSpaceTransform: CacheToHyperSingleIntraNodeTransform
  } {
    // 1. Normalize NodeWithPortPoints
    const node = this.nodeWithPortPoints
    const center = node.center
    const normalizedConnectionGroups = Object.values(
      node.portPoints.reduce(
        (acc, portPoint) => {
          acc[portPoint.connectionName] ??= {
            realConnectionName: portPoint.connectionName,
            points: [],
          }
          acc[portPoint.connectionName]!.points.push({
            x: roundCoord(portPoint.x - center.x),
            y: roundCoord(portPoint.y - center.y),
            z: portPoint.z ?? 0,
          })
          return acc
        },
        {} as Record<
          string,
          {
            realConnectionName: string
            points: Array<{ x: number; y: number; z: number }>
          }
        >,
      ),
    )
      .map((group) => ({
        ...group,
        points: group.points.sort(
          (a, b) => a.x - b.x || a.y - b.y || a.z - b.z,
        ),
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

    const normalizedPortPoints = normalizedConnectionGroups.flatMap(
      ({ realConnectionName, points }) =>
        points.map((point) => ({
          connectionName: realToCacheConnectionName[realConnectionName],
          ...point,
        })),
    )

    const normalizedNodeData = {
      width: roundCoord(node.width),
      height: roundCoord(node.height),
      availableZ: node.availableZ ? [...node.availableZ].sort() : undefined,
      portPoints: normalizedPortPoints,
    }

    const normalizedRelevantConnMap: string[][] = []

    for (const portPoint of normalizedPortPoints) {
      const relevantConnMap = this.connMap?.getIdsConnectedToNet(
        portPoint.connectionName,
      )
      if (relevantConnMap) {
        normalizedRelevantConnMap.push(relevantConnMap)
      }
    }

    // 2. Normalize HyperParameters (select and sort relevant ones)
    // Adjust this list based on which parameters actually affect this solver

    // 3. Create Key Data and Hash
    // Note: connMap is omitted as hashing it is complex and might be too broad.
    const keyData = {
      normalizedNodeData,
      // TODO connMap
    }

    const cacheKey = `intranode:${objectHash(keyData)}`
    const cacheToSolveSpaceTransform: CacheToHyperSingleIntraNodeTransform = {
      center,
      realToCacheConnectionName,
      cacheToRealConnectionName,
    }

    this.cacheKey = cacheKey
    this.cacheToSolveSpaceTransform = cacheToSolveSpaceTransform

    return { cacheKey, cacheToSolveSpaceTransform }
  }

  applyCachedSolution(cachedSolution: CachedSolvedHyperSingleIntraNode): void {
    if (cachedSolution.success) {
      const transform =
        this.cacheToSolveSpaceTransform ??
        this.computeCacheKeyAndTransform().cacheToSolveSpaceTransform
      this.solvedRoutes = structuredClone(cachedSolution.solvedRoutes).map(
        (route) =>
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
      this.solved = false
      this.failed = true
    }
    this.cacheHit = true // Mark that we used a cached result
    this.progress = 1 // Mark as complete
  }

  attemptToUseCacheSync(): boolean {
    this.hasAttemptedToUseCache = true
    if (!this.cacheProvider?.isSyncCache) {
      // console.log("Cache provider is not synchronous, skipping sync cache check.")
      return false
    }

    if (!this.cacheKey) {
      try {
        this.computeCacheKeyAndTransform()
      } catch (error) {
        console.error("Error computing cache key:", error)
        return false // Cannot use cache if key generation fails
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
        // console.log(`Cache hit for HyperSingleIntraNodeSolver: ${this.cacheKey}`)
        this.applyCachedSolution(
          cachedSolution as CachedSolvedHyperSingleIntraNode,
        )
        return true // Cache hit and applied
      } else {
        // console.log(`Cache miss for HyperSingleIntraNodeSolver: ${this.cacheKey}`)
      }
    } catch (error) {
      console.error("Error attempting to use cache:", error)
      // Decide how to handle cache read errors, e.g., treat as miss
    }

    return false // Cache miss or error
  }

  saveToCacheSync(): void {
    if (!this.cacheKey) {
      console.error(
        "Cannot save to cache without cache key. Trying to compute.",
      )
      try {
        this.computeCacheKeyAndTransform()
        if (!this.cacheKey) {
          console.error("Still failed to compute cache key. Cannot save.")
          return
        }
      } catch (error) {
        console.error("Error computing cache key during save:", error)
        return
      }
    }

    if (!this.cacheProvider?.isSyncCache) {
      // console.log("Cache provider is not synchronous, skipping sync cache save.")
      return
    }

    let solutionToCache: CachedSolvedHyperSingleIntraNode

    if (this.failed) {
      solutionToCache = { success: false }
    } else if (this.solved) {
      const transform =
        this.cacheToSolveSpaceTransform ??
        this.computeCacheKeyAndTransform().cacheToSolveSpaceTransform
      solutionToCache = {
        success: true,
        solvedRoutes: structuredClone(this.solvedRoutes).map((route) =>
          translateRoute(
            route,
            { x: -transform.center.x, y: -transform.center.y },
            transform.realToCacheConnectionName,
          ),
        ),
      }
    } else {
      // Solver finished without being solved or failed? Should not happen in typical flow.
      // console.warn("Attempting to save cache for solver that is neither solved nor failed.")
      return // Don't cache intermediate states unless intended
    }

    try {
      // console.log(`Saving to cache for HyperSingleIntraNodeSolver: ${this.cacheKey}`)
      this.cacheProvider.setCachedSolutionSync(this.cacheKey, solutionToCache)
    } catch (error) {
      console.error("Error saving solution to cache:", error)
      // Handle cache write errors if necessary
    }
  }
}
