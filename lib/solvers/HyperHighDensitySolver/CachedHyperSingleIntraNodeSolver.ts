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

// Define the transform type (currently unused but required by the interface)
type CacheToHyperSingleIntraNodeTransform = Record<string, never> // Or define specific transform data if needed

// Round coordinates to mitigate floating point inconsistencies in cache keys

// Round to nearest 5um (0.005mm)
const roundCoord = (n: number) => Math.round(n * 200) / 200

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
    const connectionNameToNormNameMap = new Map<string, string>()

    // TODO connection names need proper normalization

    // 1. Normalize NodeWithPortPoints
    const node = this.nodeWithPortPoints
    const center = node.center
    const normalizedPortPoints = [...node.portPoints]
      .sort((a, b) => {
        if (a.connectionName !== b.connectionName)
          return a.connectionName.localeCompare(b.connectionName)
        if (a.x !== b.x) return a.x - b.x
        if (a.y !== b.y) return a.y - b.y
        return (a.z ?? 0) - (b.z ?? 0)
      })
      .map((pp) => {
        return {
          connectionName: pp.connectionName,
          x: roundCoord(pp.x - center.x),
          y: roundCoord(pp.y - center.y),
          z: pp.z ?? 0,
          // Include other relevant properties if they affect routing
          // e.g., traceThickness, viaDiameter if they vary per portPoint
        }
      })

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
    const cacheToSolveSpaceTransform = {} // No transform needed for this approach

    this.cacheKey = cacheKey
    this.cacheToSolveSpaceTransform = cacheToSolveSpaceTransform

    return { cacheKey, cacheToSolveSpaceTransform }
  }

  applyCachedSolution(cachedSolution: CachedSolvedHyperSingleIntraNode): void {
    if (cachedSolution.success) {
      // Important: Deep clone the cached routes if they might be mutated later
      // For now, assuming they are treated as immutable after retrieval.
      this.solvedRoutes = cachedSolution.solvedRoutes
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
      // Important: Deep clone routes if necessary before caching
      solutionToCache = { success: true, solvedRoutes: this.solvedRoutes }
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
