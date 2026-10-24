import { expect, test } from "bun:test"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { createImplicitRegionalDiagnostics, installImplicitRegionalTransitions } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installImplicitRegionalTransitions"
import { createImplicitFixture, implicitSource } from "../fixtures/implicit-regional-fixture"

test("integrated lazy search reconstructs the explicit finite-graph shortest witness without changing the native iteration allowance", (): void => {
  for (let seed = 0; seed < 24; seed++) {
    const oracle = createImplicitFixture(seed), solver = createImplicitFixture(seed)
    for (const s of [oracle, solver]) s.topology.regionIncidentPorts[1] = [65]
    let optimum = Infinity
    for (let port = 1; port < 65; port++) {
      const first = oracle.computeG(implicitSource(0, 0), port)
      const second = oracle.computeG(implicitSource(port, first, 1), 65)
      if (Number.isFinite(second)) optimum = Math.min(optimum, second)
    }
    const work = createImplicitRegionalDiagnostics()
    installImplicitRegionalTransitions(solver, work, true)
    solver.state.candidateQueue.clear()
    solver.state.currentRouteId = undefined; solver.state.currentRouteNetId = undefined
    solver.state.goalPortId = -1
    let accepted: Candidate | undefined
    const onPathFound = solver.onPathFound
    solver.onPathFound = function(candidate: Candidate): void {
      if (candidate.portId === 65) accepted = candidate
      onPathFound.call(this, candidate)
    }
    for (let steps = 0; !accepted && steps < 200; steps++) solver._step()
    expect(accepted).toBeDefined()
    expect(accepted!.g).toBe(optimum)
    expect(accepted!.prevCandidate?.portId).not.toBe(65)
    expect(solver.state.regionSegments[0]![0]![1]).toBe(0)
    expect(solver.state.regionSegments[1]![0]![2]).toBe(65)
    expect(solver.MAX_ITERATIONS).toBe(oracle.MAX_ITERATIONS)
    expect(work.implicitFamilies).toBeGreaterThan(0)
    expect(work.implicitCandidateQueues).toBeLessThan(64)
  }
})
