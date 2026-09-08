import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import { createPhysicalPortfolioParams } from "tests/solvers/fixtures/createPhysicalPortfolioParams"

type CachedPortfolioValue = Parameters<
  CachedPortfolioSingleIntraNodeSolver["applyCachedSolution"]
>[0]

test("physical portfolio cache entries cannot bypass changed fixed-copper geometry", (): void => {
  const params = createPhysicalPortfolioParams()
  const changedIndex = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [0],
        ownerNetIds: new Set(["foreign"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.1,
  })
  const values: CachedPortfolioValue[] = [
    { success: false },
    {
      success: true,
      solvedRoutes: [
        {
          connectionName: "signal",
          traceThickness: 0.15,
          viaDiameter: 0.3,
          route: [
            { x: -1, y: 0, z: 0 },
            { x: 1, y: 0, z: 0 },
          ],
          vias: [],
        },
      ],
    },
  ]
  for (const value of values) {
    const cacheProvider = new InMemoryCache()
    const original = new CachedPortfolioSingleIntraNodeSolver({
      ...params,
      cacheProvider,
    })
    cacheProvider.setCachedSolutionSync(
      original.computeCacheKeyAndTransform().cacheKey,
      value,
    )
    const changed = new CachedPortfolioSingleIntraNodeSolver({
      ...params,
      cacheProvider,
      physicalClearanceContext: {
        ...params.physicalClearanceContext,
        traceClearanceIndex: changedIndex,
      },
    })
    expect(changed.attemptToUseCacheSync()).toBeFalse()
    expect(changed.solved).toBeFalse()
    expect(changed.failed).toBeFalse()
    expect(changed.supervisedSolvers).toBeUndefined()
    const sameDomain = new CachedPortfolioSingleIntraNodeSolver({
      ...params,
      cacheProvider,
    })
    expect(sameDomain.attemptToUseCacheSync()).toBeTrue()
    expect(sameDomain.solved).toBe(value.success)
    expect(sameDomain.failed).toBe(!value.success)
    if (value.success) {
      expect(sameDomain.solvedRoutes).toEqual(value.solvedRoutes)
    }
    expect(sameDomain.iterations).toBe(0)
    expect(cacheProvider.cacheHits).toBe(1)
    expect(cacheProvider.cacheMisses).toBe(1)
  }
})
