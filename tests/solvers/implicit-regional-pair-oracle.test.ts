import { expect, test } from "bun:test"
import { createImplicitRegionalDiagnostics, installImplicitRegionalTransitions } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installImplicitRegionalTransitions"
import { createImplicitFixture, expandImplicitFixture, implicitSource } from "../fixtures/implicit-regional-fixture"

test("lazy source families emit the exact finite directed-pair minima with native resource filters", (): void => {
  for (let seed = 0; seed < 16; seed++) {
    const native = createImplicitFixture(seed), lazy = createImplicitFixture(seed)
    for (const solver of [native, lazy]) {
      solver.state.portAssignment[7] = 2
      solver.problem.portSectionMask[9] = 0
      solver.topology.regionIncidentPorts[0]!.push(17, 17)
    }
    const work = createImplicitRegionalDiagnostics()
    installImplicitRegionalTransitions(lazy, work, true)
    const sources = [implicitSource(0, 0.03), implicitSource(1, 0.011), implicitSource(2, 0.045)]
    for (const source of sources) {
      expandImplicitFixture(native, source)
      expandImplicitFixture(lazy, source)
    }
    // Every eligible implicit row is still a geometric family at this point.
    expect(lazy.state.candidateQueue.toArray().length).toBe(0)
    const expected = new Map(native.state.candidateQueue.toArray().map(c => [c.hopId!, c.g]))
    const actual = new Map<number, number>()
    let lastF = -Infinity
    for (;;) {
      const candidate = lazy.state.candidateQueue.dequeue()
      if (!candidate) break
      expect(candidate.f >= lastF).toBe(true)
      lastF = candidate.f
      expect(actual.has(candidate.hopId!)).toBe(false)
      actual.set(candidate.hopId!, candidate.g)
      expect(candidate.prevCandidate).toBeDefined()
    }
    expect(actual).toEqual(expected)
    expect(work.implicitFamilies).toBeGreaterThan(0)
    expect(work.implicitCandidateQueues).toBeLessThanOrEqual(sources.length * 65)
    expect(lazy.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
    expect(lazy.iterations).toBe(native.iterations)
  }
})
