import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createPhysicalPortfolioParams } from "tests/solvers/fixtures/createPhysicalPortfolioParams"

class BorrowingCache extends InMemoryCache {
  override getCachedSolutionSync(cacheKey: string): unknown {
    const value = this.cache.get(cacheKey)
    if (value === undefined) this.cacheMisses++
    else this.cacheHits++
    return value
  }

  override setCachedSolutionSync(
    cacheKey: string,
    cachedSolution: unknown,
  ): void {
    // The provider interface does not promise ownership isolation; the
    // production in-memory provider's own cloning must not hide this case.
    this.cache.set(cacheKey, cachedSolution)
  }
}

test("physical portfolio owns cache copies even when its provider lends route objects", (): void => {
  const params = createPhysicalPortfolioParams()
  const cacheProvider = new BorrowingCache()
  const route: HighDensityIntraNodeRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [],
  }
  const expected = structuredClone(route)
  const original = new CachedPortfolioSingleIntraNodeSolver({
    ...params,
    cacheProvider,
  })
  original.solved = true
  original.solvedRoutes = [route]
  original.saveToCacheSync()
  route.route[0]!.x = 99

  const firstRead = new CachedPortfolioSingleIntraNodeSolver({
    ...params,
    cacheProvider,
  })
  expect(firstRead.attemptToUseCacheSync()).toBeTrue()
  expect(firstRead.solvedRoutes).toEqual([expected])
  firstRead.solvedRoutes[0]!.route[0]!.x = -99
  const secondRead = new CachedPortfolioSingleIntraNodeSolver({
    ...params,
    cacheProvider,
  })
  expect(secondRead.attemptToUseCacheSync()).toBeTrue()
  expect(secondRead.solvedRoutes).toEqual([expected])
  expect(secondRead.solvedRoutes).not.toBe(firstRead.solvedRoutes)

  const legacy = new CachedPortfolioSingleIntraNodeSolver({
    ...params,
    physicalClearanceContext: undefined,
  })
  const borrowedRoutes = [expected]
  legacy.applyCachedSolution({ success: true, solvedRoutes: borrowedRoutes })
  expect(legacy.solvedRoutes).toBe(borrowedRoutes)
})
