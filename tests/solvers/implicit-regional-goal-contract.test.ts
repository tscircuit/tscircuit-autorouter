import { expect, test } from "bun:test"
import { createImplicitRegionalDiagnostics, installImplicitRegionalTransitions } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installImplicitRegionalTransitions"
import { createImplicitFixture, expandImplicitFixture, implicitSource } from "../fixtures/implicit-regional-fixture"

test("native goal early return and rejected goal callback remain eager and suppress later exits", (): void => {
  const solver = createImplicitFixture(), work = createImplicitRegionalDiagnostics()
  solver.state.goalPortId = 1
  solver.topology.regionIncidentPorts[0] = [1, ...solver.topology.regionIncidentPorts[0]!]
  let callbacks = 0
  solver.onPathFound = (): void => { callbacks++ }
  installImplicitRegionalTransitions(solver, work, true)
  expandImplicitFixture(solver, implicitSource(0, 0))
  expect(callbacks).toBe(1)
  expect(solver.state.candidateQueue.length).toBe(0)
  expect(work.implicitGoalNativeExpansions).toBe(1)
  expect(work.implicitFamilies).toBe(0)
  expect(work.implicitCandidateQueues).toBe(0)
})
