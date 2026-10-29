import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { getFuturePointCacheShadowStats } from "lib/solvers/HighDensitySolver/futurePointCacheContext"
import { makeFuturePointOptions, makeOwnedFuturePointSolver, queryNode, type Point } from "./fixtures/futurePointCacheSynthetic"

test("legacy shadow counterfactual work matches actual unmodified native scans on each owned query epoch", () => {
  for (const count of [8, 32, 64, 128]) {
    const { solver: candidate, stats } = makeOwnedFuturePointSolver(count)
    const native = new Native(makeFuturePointOptions(count))
    const shadow = getFuturePointCacheShadowStats(stats)
    let scanStarts = 0, scannedPoints = 0, expectedHits = 0, expectedMisses = 0
    const install = (points: Point[]): void => {
      points.forEach(Object.freeze)
      candidate.futureConnectionPoints = points
      const nativePoints = points.slice()
      Object.defineProperty(nativePoints, Symbol.iterator, { value: function* (this: Point[]) {
        scanStarts++
        for (let index = 0; index < this.length; index++) {
          scannedPoints++
          yield this[index]
        }
      } })
      native.futureConnectionPoints = nativePoints
    }
    install(candidate.futureConnectionPoints)
    const check = (query: ReturnType<typeof queryNode>): void => {
      const before = scanStarts
      const nativePoint = native.getClosestFutureConnectionPoint(query)
      const actual = candidate.getClosestFutureConnectionPoint(query)
      expect(actual).toBe(nativePoint)
      if (scanStarts === before) expectedHits++
      else { expect(scanStarts - before).toBe(1); expectedMisses++ }
      expect(shadow.legacyHits).toBe(expectedHits)
      expect(shadow.legacyMisses).toBe(expectedMisses)
      expect(shadow.legacyDistanceEvaluations).toBe(scannedPoints)
      expect(shadow.candidateHits).toBe(stats.hits)
      expect(shadow.candidateMisses).toBe(stats.misses)
      expect(shadow.candidateDistanceEvaluations).toBe(stats.distanceEvaluations)
      expect(shadow.assertedLegacyHits).toBe(expectedHits)
    }
    for (let index = 0; index < 600; index++) {
      const query = queryNode((index * 17 % 91 - 45) * .05, (index * 13 % 87 - 43) * .05, index % 4)
      for (const q of [query, { ...query }, { ...query, x: query.x + .004 }, query]) check(q)
    }
    for (const q of [queryNode(-0, 0, 0), queryNode(0, -0, 1), queryNode(NaN, 0, 0), queryNode(Infinity, 0, 0), queryNode(1e150, -1e150, 3)]) check(q)
    const tied = [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, ...Array.from({ length: 6 }, () => ({ x: 100, y: 100, z: 0 }))]
    install(tied); check(queryNode(0, 0, 0)); check(queryNode(0, 0, 0))
    install(tied.toReversed()); check(queryNode(0, 0, 0))
    // A same-identity resize invalidates both caches, independently of replacement.
    const added = Object.freeze({ x: 0, y: 0, z: 1 })
    candidate.futureConnectionPoints.push(added); native.futureConnectionPoints.push(added)
    candidate.VIA_PENALTY_FACTOR = 0; native.VIA_PENALTY_FACTOR = 0
    check(queryNode(0, 0, 0)); check(queryNode(0, 0, 0))
    candidate.VIA_PENALTY_FACTOR = 2; native.VIA_PENALTY_FACTOR = 2
    check(queryNode(0, 0, 0)); check(queryNode(0, 0, 0))
    install(Array.from({ length: 8 }, () => ({ x: NaN, y: NaN, z: 0 })))
    check(queryNode(0, 0, 0)); check(queryNode(0, 0, 0))
    install([]); check(queryNode(0, 0, 0)); check(queryNode(0, 0, 0))
    expect(shadow.instances).toBe(1)
    expect(shadow.lookups).toBe(shadow.legacyHits + shadow.legacyMisses)
    expect(shadow.lookups).toBe(shadow.bothHits + shadow.legacyOnlyHits + shadow.candidateOnlyHits + shadow.bothMisses)
    expect(shadow.legacyHits).toBe(shadow.bothHits + shadow.legacyOnlyHits)
    expect(shadow.candidateHits).toBe(shadow.bothHits + shadow.candidateOnlyHits)
    expect(shadow.invalidations).toBe(stats.invalidations)
    expect(shadow.uncacheableQueries).toBe(stats.uncacheableQueries)
    expect(shadow.indexMismatches).toBe(0)
  }
})
