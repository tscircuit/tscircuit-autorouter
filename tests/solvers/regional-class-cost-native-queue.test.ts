import { expect, test } from "bun:test"
import { createRegionalClassCostDiagnostics, installRegionalClassCosts } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installRegionalClassCosts"
import { createRegionalClassFixture, expandRegionalClassFixture, regionalClassSource } from "../fixtures/regional-class-cost-fixture"

test("cost sharing preserves native eager candidate arrays, every prefix and dequeue order", (): void => {
  for (let seed = 0; seed < 6; seed++) {
    const native = createRegionalClassFixture(seed), candidate = createRegionalClassFixture(seed)
    for (const solver of [native, candidate]) {
      solver.state.currentRouteNetId = 1
      solver.appendSegmentToRegionCache(0, 7, 31)
      solver.appendSegmentToRegionCache(0, 13, 55)
      solver.state.currentRouteNetId = 0
    }
    const work = createRegionalClassCostDiagnostics()
    installRegionalClassCosts(candidate, work, true)
    for (let port = 0; port < 65; port++) {
      const source = regionalClassSource(port, ((port * 73 + seed) % 97) / 191)
      expandRegionalClassFixture(native, source)
      expandRegionalClassFixture(candidate, source)
      expect(candidate.state.candidateQueue.toArray()).toEqual(native.state.candidateQueue.toArray())
    }
    for (;;) {
      const expected = native.state.candidateQueue.dequeue()
      const actual = candidate.state.candidateQueue.dequeue()
      expect(actual).toEqual(expected)
      if (!expected) break
    }
    expect(work.classCostHits).toBeGreaterThan(0)
  }
})
