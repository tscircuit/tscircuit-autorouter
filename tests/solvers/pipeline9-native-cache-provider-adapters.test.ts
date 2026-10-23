import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { createPipeline9RegularNodeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("ordinary, regional and direct portfolios retain the selected native cache provider", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "cache-adapter", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [
    { connectionName: "signal", x: -2, y: 0, z: 0 }, { connectionName: "signal", x: 2, y: 0, z: 0 },
  ] }
  const common = { nodeWithPortPoints: node, connMap: new ConnectivityMap({}), colorMap: {}, viaDiameter: 0.3, traceWidth: 0.1, obstacleMargin: 0.15, effort: 0.1, nodePfById: {}, obstacles: [], layerCount: 2 }
  const globalCache = getGlobalInMemoryCache()
  globalCache.clearCache()
  const custom = new InMemoryCache()
  for (const cacheProvider of [undefined, null, custom]) {
    const selected = cacheProvider === undefined ? globalCache : cacheProvider
    const regular = createPipeline9RegularNodeSolver({ ...common, cacheProvider })
    const regional = new Pipeline9RegionalFallbackSolver({ ...common, cacheProvider })
    const direct = new HighDensitySolver({ ...common, nodePortPoints: [node], cacheProvider })
    for (const solver of [regular, regional.highDensitySolver, direct]) {
      expect(solver.cacheProvider).toBe(selected)
      solver.step()
      if (solver.activeSubSolver instanceof GrowShrinkHighDensityIntraNodeSolver) {
        expect(solver.activeSubSolver.getConstructorParams().cacheProvider).toBe(selected)
      }
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.stats.intraNodeCacheHits).toBe(selected?.cacheHits ?? 0)
      expect(solver.stats.intraNodeCacheMisses).toBe(selected?.cacheMisses ?? 0)
    }
    // The constructor contract also reaches a concrete native cache kernel.
    const kernel = new CachedIntraNodeRouteSolver({ ...common, cacheProvider })
    expect(kernel.cacheProvider).toBe(selected)
    kernel.solve()
    expect(kernel.solved).toBe(true)
  }
  expect(custom.getAllCacheKeys().some((key) => key.startsWith("intranode-solver:"))).toBe(true)
  globalCache.clearCache()
})
