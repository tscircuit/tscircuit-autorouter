import { expect, test } from "bun:test"
import { createJointLayerCacheFixture, runJointLayerCacheFixture } from "tests/utils/joint-layer-cache"

test("bounded joint-layer caches preserve uncached search order, decisions and final evaluations", (): void => {
  const cacheFields = new Set(["variantCacheHits", "variantCacheMisses", "pairCacheHits",
    "pairCacheMisses", "cachedVariantCount", "cachedPairCount", "staticGeometryEvaluations",
    "staticObstacleBroadphaseRejected", "staticPrimitiveBroadphaseRejected", "staticDistanceEvaluations"])
  let variantHits = 0, pairHits = 0, multipleAccepts = 0
  for (const blind of [false, true]) {
    for (const limit of [50, 500, 20000]) {
      const fixture = createJointLayerCacheFixture(blind)
      const snapshot = structuredClone(fixture.routes)
      const cached = runJointLayerCacheFixture(fixture, false, limit)
      const uncached = runJointLayerCacheFixture(fixture, true, limit)
      expect(cached.output).toEqual(uncached.output)
      expect(cached.evaluations).toEqual(uncached.evaluations)
      const originalStats = (stats: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(Object.entries(stats).filter(([key]) => !cacheFields.has(key)))
      expect(originalStats(cached.stats)).toEqual(originalStats(uncached.stats))
      expect(fixture.routes).toEqual(snapshot)
      expect(cached.stats.cachedVariantCount).toBeLessThanOrEqual(1024)
      expect(cached.stats.cachedPairCount).toBeLessThanOrEqual(32768)
      expect(uncached.stats.variantCacheHits).toBe(0)
      expect(uncached.stats.pairCacheHits).toBe(0)
      variantHits += Number(cached.stats.variantCacheHits)
      pairHits += Number(cached.stats.pairCacheHits)
      if (Number(cached.stats.accepted) > 1) multipleAccepts++
      expect(cached.stats.copperRejected).toBeGreaterThan(0)
      expect(cached.stats.variantCacheMisses).toBeLessThanOrEqual(Number(uncached.stats.variantCacheMisses))
      expect(cached.stats.pairCacheMisses).toBeLessThanOrEqual(Number(uncached.stats.pairCacheMisses))
    }
  }
  expect(variantHits).toBeGreaterThan(0)
  expect(pairHits).toBeGreaterThan(0)
  expect(multipleAccepts).toBeGreaterThan(0)
})
