import { expect, test } from "bun:test"
import { FuturePointCacheShadow, createFuturePointCacheShadowStats } from "lib/solvers/HighDensitySolver/futurePointCacheShadow"

test("a shadow-hit selected-index divergence throws explicitly including null and avoids distance scans", () => {
  for (const accepted of [-1, 0, 1]) {
    const stats = createFuturePointCacheShadowStats()
    const shadow = new FuturePointCacheShadow(stats)
    const points = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]
    Object.defineProperty(points, Symbol.iterator, { value: () => { throw new Error("Shadow must never scan future points") } })
    shadow.record(0, 0, 0, 0, 1, points, accepted, false, 2)
    shadow.record(0, 0, 0, 0, 1, points, accepted, true, 0)
    expect(stats.legacyDistanceEvaluations).toBe(2)
    expect(stats.assertedLegacyHits).toBe(1)
    expect(() => shadow.record(0, 0, 0, 0, 1, points, accepted === -1 ? 0 : -1, true, 0)).toThrow("Future-point legacy shadow index divergence")
    expect(stats.indexMismatches).toBe(1)
  }
})
