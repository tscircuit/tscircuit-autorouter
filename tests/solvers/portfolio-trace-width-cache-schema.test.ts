import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import objectHash from "object-hash"

test("portfolio physical domain rejects schemas 3, 4 and 5 and accepts schema 6 cache entries", async (): Promise<void> => {
  const memoryCacheDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE",
  )
  const localCacheDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "TSCIRCUIT_AUTOROUTER_LOCAL_STORAGE_CACHE",
  )
  try {
    // This module initializes global caches on import. Use a private provider
    // below, and restore any import-created global properties in finally.
    const { CachedPortfolioSingleIntraNodeSolver } = await import(
      "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
    )
    const cache = new InMemoryCache()
    const node: NodeWithPortPoints = {
      capacityMeshNodeId: "width-cache-node",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      portPoints: [
        {
          connectionName: "signal",
          portPointId: "left",
          x: -0.5,
          y: 0,
          z: 0,
        },
        {
          connectionName: "signal",
          portPointId: "right",
          x: 0.5,
          y: 0,
          z: 0,
        },
      ],
    }
    const params = {
      nodeWithPortPoints: node,
      traceWidth: 0.2,
      viaDiameter: 0.3,
      obstacleMargin: 0.1,
      hyperParameters: { MULTI_HEAD_POLYLINE_SOLVER: true },
      cacheProvider: cache,
    }
    // An explicit legacy key fixture proves that the miss is caused by the
    // schema version, not by a different node, width, or hyperparameter.
    const legacyKeyData = {
      cacheSchemaVersion: 3,
      normalizedNodeData: {
        width: 1,
        height: 1,
        center: { x: 0, y: 0 },
        availableZ: [0, 1],
        portPoints: [
          {
            connectionName: "signal",
            portPointId: "left",
            x: -0.5,
            y: 0,
            z: 0,
            prevPortPointId: undefined,
            nextPortPointId: undefined,
          },
          {
            connectionName: "signal",
            portPointId: "right",
            x: 0.5,
            y: 0,
            z: 0,
            prevPortPointId: undefined,
            nextPortPointId: undefined,
          },
        ],
      },
      normalizedHyperParameters: { MULTI_HEAD_POLYLINE_SOLVER: true },
      traceWidth: 0.2,
      viaDiameter: 0.3,
      obstacleMargin: 0.1,
    }
    const legacyKey = `intranode:${objectHash(legacyKeyData)}`
    const previousKey = `intranode:${objectHash({
      ...legacyKeyData,
      cacheSchemaVersion: 4,
    })}`
    const previousPhysicalKey = `intranode:${objectHash({
      ...legacyKeyData,
      cacheSchemaVersion: 5,
    })}`
    const currentKey = `intranode:${objectHash({
      ...legacyKeyData,
      cacheSchemaVersion: 6,
    })}`
    const legacyRoute: HighDensityRoute = {
      connectionName: "signal",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: -0.5, y: 0, z: 0 },
        { x: 0.5, y: 0, z: 0 },
      ],
      vias: [],
    }
    cache.setCachedSolutionSync(legacyKey, {
      success: true,
      solvedRoutes: [legacyRoute],
    })
    cache.setCachedSolutionSync(previousKey, {
      success: true,
      solvedRoutes: [legacyRoute],
    })
    cache.setCachedSolutionSync(previousPhysicalKey, {
      success: true,
      solvedRoutes: [legacyRoute],
    })
    const miss = new CachedPortfolioSingleIntraNodeSolver(params)
    expect(miss.computeCacheKeyAndTransform().cacheKey).toBe(currentKey)
    expect(currentKey).not.toBe(legacyKey)
    expect(currentKey).not.toBe(previousKey)
    expect(currentKey).not.toBe(previousPhysicalKey)
    expect(miss.attemptToUseCacheSync()).toBeFalse()
    expect(miss.hasAttemptedToUseCache).toBeTrue()
    expect(miss.cacheHit).toBeFalse()
    expect(miss.solved).toBeFalse()
    expect(miss.failed).toBeFalse()
    expect(miss.solvedRoutes).toEqual([])
    expect(miss.iterations).toBe(0)
    expect(cache.cacheMisses).toBe(1)
    expect(cache.cacheHits).toBe(0)

    const currentRoute: HighDensityRoute = {
      ...legacyRoute,
      traceThickness: params.traceWidth,
    }
    cache.setCachedSolutionSync(currentKey, {
      success: true,
      solvedRoutes: [currentRoute],
    })
    const hit = new CachedPortfolioSingleIntraNodeSolver(params)
    expect(hit.attemptToUseCacheSync()).toBeTrue()
    expect(hit.cacheKey).toBe(currentKey)
    expect(hit.cacheHit).toBeTrue()
    expect(hit.solved).toBeTrue()
    expect(hit.failed).toBeFalse()
    expect(hit.solvedRoutes).toEqual([currentRoute])
    expect(hit.solvedRoutes[0]!.traceThickness).toBe(0.2)
    expect(hit.iterations).toBe(0)
    expect(cache.cacheMisses).toBe(1)
    expect(cache.cacheHits).toBe(1)
    expect(cache.getAllCacheKeys().sort()).toEqual(
      [legacyKey, previousKey, previousPhysicalKey, currentKey].sort(),
    )
  } finally {
    if (memoryCacheDescriptor) {
      Object.defineProperty(
        globalThis,
        "TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE",
        memoryCacheDescriptor,
      )
    } else {
      Reflect.deleteProperty(globalThis, "TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE")
    }
    if (localCacheDescriptor) {
      Object.defineProperty(
        globalThis,
        "TSCIRCUIT_AUTOROUTER_LOCAL_STORAGE_CACHE",
        localCacheDescriptor,
      )
    } else {
      Reflect.deleteProperty(
        globalThis,
        "TSCIRCUIT_AUTOROUTER_LOCAL_STORAGE_CACHE",
      )
    }
  }
})
