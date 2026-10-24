import { expect, test } from "bun:test"
import { createRegionalClassCostDiagnostics, installRegionalClassCosts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installRegionalClassCosts"
import { createRegionalClassFixture, regionalClassSource } from "../fixtures/regional-class-cost-fixture"

test("strict angular and layer classes preserve native binary64 costs in both directions and at pruning boundaries", (): void => {
  for (let seed = 0; seed < 8; seed++) {
    const layers = seed % 2 ? [0, 1, 4, 31] : [0, 1]
    const native = createRegionalClassFixture(seed, layers), candidate = createRegionalClassFixture(seed, layers)
    for (const solver of [native, candidate]) {
      solver.state.currentRouteNetId = 1
      solver.appendSegmentToRegionCache(0, 7, 31)
      solver.appendSegmentToRegionCache(0, 13, 55)
      solver.state.currentRouteNetId = 0
      solver.state.regionCongestionCost[0] = 0.31
    }
    const work = createRegionalClassCostDiagnostics()
    installRegionalClassCosts(candidate, work, true)
    for (let a = 0; a < 65; a++) for (let b = 0; b < 65; b++) {
      const source = regionalClassSource(a, ((a * 13 + b * 31 + seed) % 100) / 11)
      const expected = native.computeG(source, b)
      expect(candidate.computeG(source, b)).toBe(expected)
      const limit = expected - 1e-8
      expect(candidate.computeG(source, b, limit)).toBe(native.computeG(source, b, limit))
      const dx = native.topology.portX[a]! - native.topology.portX[b]!
      const dy = native.topology.portY[a]! - native.topology.portY[b]!
      const distance = Math.sqrt(dx * dx + dy * dy)
      expect(candidate.computeG(source, b, expected, distance)).toBe(native.computeG(source, b, expected, distance))
    }
    expect(work.installedSolvers).toBe(1)
    expect(work.classCostQueries).toBeGreaterThan(0)
    expect(work.classCostHits).toBeGreaterThan(work.classCostQueries)
  }
})
