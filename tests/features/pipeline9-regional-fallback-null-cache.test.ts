import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("regional fallback with an explicitly disabled cache ignores a warm process cache", (): void => {
  const previousCache = globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE
  const cache = new InMemoryCache()
  globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = cache
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cache-region", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
    portPoints: [[-1, 1], [0, 0], [1, -1]].flatMap(([start, end], index) => [
      { x: -2, y: start, z: 0, connectionName: `signal-${index}` },
      { x: 2, y: end, z: 0, connectionName: `signal-${index}` },
    ]),
  }
  const params = { nodeWithPortPoints: node, colorMap: {}, connMap: new ConnectivityMap({}), viaDiameter: 0.3,
    traceWidth: 0.1, obstacleMargin: 0.1, effort: 0.1, obstacles: [], layerCount: 2 }
  try {
    const warmup = new Pipeline9RegionalFallbackSolver(params)
    warmup.solve()
    expect(warmup.solved).toBe(true)
    expect(cache.cache.size).toBeGreaterThan(0)
    const hits = cache.cacheHits
    const misses = cache.cacheMisses
    const first = new Pipeline9RegionalFallbackSolver({ ...params, cacheProvider: null })
    const second = new Pipeline9RegionalFallbackSolver({ ...params, cacheProvider: null })
    first.solve()
    second.solve()
    expect(first.solved).toBe(true)
    expect(second.solved).toBe(true)
    expect(first.failed).toBe(false)
    expect(second.failed).toBe(false)
    expect(second.getOutput()).toEqual(first.getOutput())
    expect(second.iterations).toBe(first.iterations)
    expect(second.highDensitySolver.iterations).toBe(first.highDensitySolver.iterations)
    expect(cache.cacheHits).toBe(hits)
    expect(cache.cacheMisses).toBe(misses)
    expect(first.highDensitySolver.stats.intraNodeCacheHits).toBe(0)
    expect(second.highDensitySolver.stats.intraNodeCacheMisses).toBe(0)
  } finally {
    globalThis.TSCIRCUIT_AUTOROUTER_IN_MEMORY_CACHE = previousCache
  }
})
