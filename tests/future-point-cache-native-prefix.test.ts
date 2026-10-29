import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { createFuturePointCacheStats, registerOwnedFuturePointCacheOptions } from "lib/solvers/HighDensitySolver/futurePointCacheContext"
import { makeFuturePointOptions } from "./fixtures/futurePointCacheSynthetic"

const expectNativeState = (a: Native, b: Native): void => {
  const cacheFields = new Set(["closestFuturePointCacheCoordinates", "closestFuturePointCacheIndices"])
  for (const key of Object.keys(a)) {
    if (!cacheFields.has(key)) expect((b as any)[key]).toEqual((a as any)[key])
  }
  expect(b.solvedPath).toEqual(a.solvedPath)
  expect(b.getSolverName()).toBe(a.getSolverName())
}

test("changed placement preserves native search queues, budgets, costs and route prefixes on frozen owned futures", () => {
  for (const count of [8, 32, 64, 128]) {
    for (let seed = 0; seed < 4; seed++) {
      const opts = makeFuturePointOptions(count, seed)
      for (const connection of opts.futureConnections!) {
        connection.points.forEach(Object.freeze)
        Object.freeze(connection.points)
        Object.freeze(connection)
      }
      Object.freeze(opts.futureConnections)
      const native = new Native(opts)
      const stats = createFuturePointCacheStats()
      registerOwnedFuturePointCacheOptions(opts, stats)
      const optimized = new Native(opts)
      expect(stats.instances).toBe(1)
      for (let step = 0; step < 350 && !native.solved && !native.failed; step++) {
        native.step(); optimized.step()
        if (step % 31 === 0 || native.solved || native.failed) expectNativeState(native, optimized)
      }
      expectNativeState(native, optimized)
      expect(stats.lookups).toBeGreaterThan(0)
      expect(stats.hits).toBeGreaterThan(0)
      expect(stats.mixedHashLookups).toBeGreaterThan(0)
      expect(stats.associativeLookups > 0).toBe(count >= 64)
      expect(stats.distanceEvaluations).toBe(stats.misses * count)
      expect(stats.lookups).toBe(stats.hits + stats.misses)
    }
  }
})
