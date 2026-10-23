import { expect, test } from "bun:test"
import { allocateCompatibleTinyRouteCandidates } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/allocateCompatibleTinyRouteCandidates"
import { createJointCandidateCacheFixture, jointCandidateSemanticStats } from "../fixtures/createJointCandidateCacheFixture"

test("bounded regional score factors exactly preserve cyclic, pressure-barrier and physical-preload allocation including empty regions and eviction", (): void => {
  for (const kind of ["cycle", "pressure", "preload"] as const) {
    const oracle = createJointCandidateCacheFixture(kind, false)
    const uncached = allocateCompatibleTinyRouteCandidates(oracle, createJointCandidateCacheFixture(kind, true), { hasPreloadedCopper: kind === "preload", regionalScoreCacheCapacity: 0 })
    expect(uncached.jointCandidateMaximumExchangeSize).toBe(kind === "pressure" ? 2 : kind === "preload" ? 3 : 4)
    expect(uncached.jointCandidateMasterBudgetExhausted).toBe(0)
    for (const capacity of [2, 16_384]) {
      const candidate = createJointCandidateCacheFixture(kind, false)
      const stats = allocateCompatibleTinyRouteCandidates(candidate, createJointCandidateCacheFixture(kind, true), { hasPreloadedCopper: kind === "preload", regionalScoreCacheCapacity: capacity })
      expect(jointCandidateSemanticStats(stats)).toEqual(jointCandidateSemanticStats(uncached))
      expect(candidate.state.regionSegments).toEqual(oracle.state.regionSegments)
      expect(candidate.state.portAssignment).toEqual(oracle.state.portAssignment)
      expect(candidate.state.regionIntersectionCaches).toEqual(oracle.state.regionIntersectionCaches)
      expect(stats.jointCandidateScoreCacheMisses).toBeGreaterThan(0)
      expect(stats.jointCandidateScoreCachePeakEntries).toBeLessThanOrEqual(capacity)
      expect(stats.jointCandidateScoreCachePeakKeyCharacters).toBeLessThanOrEqual(1_048_576)
      expect(candidate.state.regionSegments[3]).toEqual([])
      if (kind === "pressure") {
        expect(stats.jointCandidateScoreConstantTerms).toBe(1)
        expect(stats.jointCandidateScoreConstantReuses).toBeGreaterThan(0)
      }
      if (capacity === 2) expect(stats.jointCandidateScoreCacheEvictions).toBeGreaterThan(0)
      else {
        expect(stats.jointCandidateScoreCacheHits).toBeGreaterThan(0)
        expect(stats.jointCandidateScoredSegmentPairs).toBeLessThan(uncached.jointCandidateScoredSegmentPairs)
      }
      if (kind === "preload") expect(candidate.state.regionSegments[0]).toEqual([[3, 6, 7]])
    }
  }
  for (const capacity of [-1, 0.5, 16_385, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => allocateCompatibleTinyRouteCandidates(createJointCandidateCacheFixture("cycle", false), createJointCandidateCacheFixture("cycle", true), { hasPreloadedCopper: false, regionalScoreCacheCapacity: capacity })).toThrow("Regional score cache capacity")
  }
})
