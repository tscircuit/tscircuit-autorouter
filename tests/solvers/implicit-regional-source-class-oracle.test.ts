import { expect, test } from "bun:test"
import { createImplicitRegionalDiagnostics, installImplicitRegionalTransitions } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installImplicitRegionalTransitions"
import { createImplicitFixture, expandImplicitFixture, implicitSource } from "../fixtures/implicit-regional-fixture"

test("exact source-class cost sharing retains all native pair minima and closes duplicate occurrences once", (): void => {
  for (let seed = 0; seed < 12; seed++) {
    const layers = seed % 2 === 0 ? [0, 1] : [0, 1, 4, 31]
    const native = createImplicitFixture(seed, layers), solver = createImplicitFixture(seed, layers)
    for (const s of [native, solver]) {
      s.topology.regionIncidentPorts[0]!.push(17, 17, 17, 18, 18, 18)
      s.state.regionCongestionCost[0] = 0.25
    }
    const work = createImplicitRegionalDiagnostics()
    installImplicitRegionalTransitions(solver, work, true)
    for (let source = 0; source < 65; source++) {
      const candidate = implicitSource(source, ((source * 73 + seed) % 97) / 191)
      expandImplicitFixture(native, candidate)
      expandImplicitFixture(solver, candidate)
    }
    const expected = new Map(native.state.candidateQueue.toArray().map(c => [c.hopId!, c.g]))
    const actual = new Map<number, number>()
    for (;;) {
      const candidate = solver.state.candidateQueue.dequeue()
      if (!candidate) break
      expect(actual.has(candidate.hopId!)).toBe(false)
      actual.set(candidate.hopId!, candidate.g)
    }
    expect(actual).toEqual(expected)
    expect(work.implicitCachedClassCosts).toBeGreaterThan(0)
    expect(work.implicitCommonCostQueries).toBeLessThan(work.implicitFamilies)
    expect(work.implicitClosureLeafVisits).toBeGreaterThan(0)
  }
})
