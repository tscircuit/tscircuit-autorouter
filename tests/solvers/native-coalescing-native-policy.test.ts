import { expect, test } from "bun:test"
import { NativeCoalescedIntraNodeSolver } from "lib/solvers/HighDensitySolver/NativeCoalescedIntraNodeSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { nativeCoalescingParams } from "./nativeCoalescingTestUtils"

test("coalesced constructor leaves native search methods, exact route streams and low-level caps untouched", () => {
  expect(Object.getOwnPropertyNames(NativeCoalescedIntraNodeSolver.prototype)).toEqual(["constructor"])
  for (const [family, seed] of [[6, 0], [20, 100]]) for (const cell of [0.5, 1]) {
    const params = { ...nativeCoalescingParams(), nativeOrderingFamilySize: family,
      hyperParameters: { SHUFFLE_SEED: seed, CELL_SIZE_FACTOR: cell, NATIVE_COALESCED_FAMILY_SIZE: family } }
    const baseline = new CachedIntraNodeRouteSolver(params), candidate = new NativeCoalescedIntraNodeSolver(params)
    expect(candidate.nativeCandidateIterationLimit).toBe(baseline.MAX_ITERATIONS)
    expect(candidate.MAX_ITERATIONS + 1).toBe(family * (Math.floor(baseline.MAX_ITERATIONS) + 1))
    expect(candidate.computeCacheKeyAndTransform()).toEqual(baseline.computeCacheKeyAndTransform())
    const originalKey = new CachedIntraNodeRouteSolver({ ...params, hyperParameters: { SHUFFLE_SEED: seed, CELL_SIZE_FACTOR: cell } })
    expect(candidate.computeCacheKeyAndTransform().cacheKey).not.toBe(originalKey.computeCacheKeyAndTransform().cacheKey)
    while (!baseline.solved && !baseline.failed) {
      baseline.step()
      candidate.step()
      expect(candidate.iterations).toBe(baseline.iterations)
      expect(candidate.solvedRoutes).toEqual(baseline.solvedRoutes)
      expect(candidate.unsolvedConnections).toEqual(baseline.unsolvedConnections)
      expect(candidate.activeSubSolver?.MAX_ITERATIONS).toBe(baseline.activeSubSolver?.MAX_ITERATIONS)
      expect(candidate.activeSubSolver?.futureConnections).toEqual(baseline.activeSubSolver?.futureConnections)
    }
    expect(baseline.solved).toBe(true)
    expect(candidate.solved).toBe(true)
    expect(candidate.solvedRoutes).toEqual(baseline.solvedRoutes)
  }
})
