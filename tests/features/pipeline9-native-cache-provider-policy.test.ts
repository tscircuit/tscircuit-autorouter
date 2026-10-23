import { expect, spyOn, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import type { CacheProvider } from "lib/cache/types"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types/srj-types"

test("Pipeline9 preserves disabled, default and caller-owned native cache lifetimes", (): void => {
  const input: SimpleRouteJson = { layerCount: 2, minTraceWidth: 0.1, obstacles: [], bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, connections: [
    { name: "signal", pointsToConnect: [{ x: -3, y: 0, layer: "top" }, { x: 3, y: 0, layer: "top" }] },
  ] }
  const globalCache = getGlobalInMemoryCache()
  globalCache.clearCache()
  const read = spyOn(globalCache, "getCachedSolutionSync")
  const write = spyOn(globalCache, "setCachedSolutionSync")
  const solve = (cacheProvider?: CacheProvider | null): Pipeline9 => {
    const solver = new Pipeline9(structuredClone(input), { effort: 0.1, cacheProvider })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    return solver
  }
  const nativeReads = (): number => read.mock.calls.filter(([key]) => key.startsWith("intranode-solver:")).length
  const nativeWrites = (): number => write.mock.calls.filter(([key]) => key.startsWith("intranode-solver:")).length
  try {
    const disabled = [solve(null), solve(null)]
    expect(nativeReads()).toBe(0)
    expect(nativeWrites()).toBe(0)
    expect(disabled[0]!.highDensityRouteSolver!.stats.learnedComputeObservedWinnerOracleWork).toBe(0.03)
    expect(disabled[1]!.highDensityRouteSolver!.stats.learnedComputeObservedWinnerOracleWork).toBe(0.03)
    expect(disabled[0]!.highDensityRouteSolver!.stats.learnedComputePortfolioWork).toBe(disabled[1]!.highDensityRouteSolver!.stats.learnedComputePortfolioWork)
    expect(disabled[0]!.getOutputSimpleRouteJson()).toEqual(disabled[1]!.getOutputSimpleRouteJson())

    const omitted = [solve(), solve()]
    expect(omitted.every((solver) => solver.cacheProvider === globalCache)).toBe(true)
    expect(nativeReads()).toBeGreaterThan(0)
    expect(nativeWrites()).toBeGreaterThan(0)
    expect(globalCache.cacheHitsByPrefix["intranode-solver"]).toBeGreaterThan(0)
    expect(omitted[0]!.getOutputSimpleRouteJson()).toEqual(omitted[1]!.getOutputSimpleRouteJson())
    read.mockClear()
    write.mockClear()

    const firstCustom = new InMemoryCache()
    const secondCustom = new InMemoryCache()
    const custom = [solve(firstCustom), solve(firstCustom)]
    expect(custom.every((solver) => solver.cacheProvider === firstCustom)).toBe(true)
    expect(firstCustom.cacheHitsByPrefix["intranode-solver"]).toBeGreaterThan(0)
    expect(firstCustom.getAllCacheKeys().some((key) => key.startsWith("intranode-solver:"))).toBe(true)
    expect(secondCustom.getAllCacheKeys()).toEqual([])
    solve(secondCustom)
    expect(secondCustom.cacheMissesByPrefix["intranode-solver"]).toBeGreaterThan(0)
    expect(secondCustom.cacheHitsByPrefix["intranode-solver"] ?? 0).toBe(0)
    expect(nativeReads()).toBe(0)
    expect(nativeWrites()).toBe(0)
    expect(custom[0]!.getOutputSimpleRouteJson()).toEqual(disabled[0]!.getOutputSimpleRouteJson())
  } finally {
    read.mockRestore()
    write.mockRestore()
    globalCache.clearCache()
  }
})
