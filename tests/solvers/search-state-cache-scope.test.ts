import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import { searchStateFactoryNode } from "./searchStateTestUtils"

test("enabled cache entries are isolated while explicit OFF keeps legacy keys", (): void => {
  for (const Solver of [CachedIntraNodeRouteSolver, CachedPortfolioSingleIntraNodeSolver]) {
    const input = { nodeWithPortPoints: searchStateFactoryNode(), cacheProvider: null }
    const baseline = new Solver(input)
    const off = new Solver({ ...input, experimentSearchState: false })
    const on = new Solver({ ...input, experimentSearchState: true })
    expect(off.computeCacheKeyAndTransform().cacheKey).toBe(baseline.computeCacheKeyAndTransform().cacheKey)
    expect(on.computeCacheKeyAndTransform().cacheKey).not.toBe(baseline.computeCacheKeyAndTransform().cacheKey)
  }
})
