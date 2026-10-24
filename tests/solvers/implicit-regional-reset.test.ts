import { expect, test } from "bun:test"
import { createImplicitRegionalDiagnostics, installImplicitRegionalTransitions } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installImplicitRegionalTransitions"
import { createImplicitFixture, expandImplicitFixture, implicitSource } from "../fixtures/implicit-regional-fixture"

test("queue clears discard every pending family and reject scene replacement without an epoch", (): void => {
  const solver = createImplicitFixture(), work = createImplicitRegionalDiagnostics()
  installImplicitRegionalTransitions(solver, work, true)
  expandImplicitFixture(solver, implicitSource(0, 0))
  expect(solver.state.candidateQueue.length).toBeGreaterThan(0)
  solver.state.candidateQueue.clear()
  expect(solver.state.candidateQueue.length).toBe(0)
  expect(solver.state.candidateQueue.dequeue()).toBeUndefined()
  expect(work.implicitDiscardedTasks).toBeGreaterThan(0)
  solver.resetCandidateBestCosts()
  solver.problem.portSectionMask[17] = 0
  solver.state.portAssignment[19] = 3
  expandImplicitFixture(solver, implicitSource(1, 0))
  const ports: number[] = []
  for (;;) { const candidate = solver.state.candidateQueue.dequeue(); if (!candidate) break; ports.push(candidate.portId) }
  expect(ports).not.toContain(17)
  expect(ports).not.toContain(19)
  solver.state.candidateQueue.clear(); solver.resetCandidateBestCosts()
  expandImplicitFixture(solver, implicitSource(0, 0))
  solver.state.regionIntersectionCaches[0] = { ...solver.state.regionIntersectionCaches[0]! }
  expect(() => solver.state.candidateQueue.dequeue()).toThrow("scene changed")
})
