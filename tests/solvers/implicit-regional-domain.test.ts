import { expect, test } from "bun:test"
import { createImplicitRegionalDiagnostics, installImplicitRegionalTransitions } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installImplicitRegionalTransitions"
import { createImplicitFixture, expandImplicitFixture, implicitSource } from "../fixtures/implicit-regional-fixture"

test("unsupported custom scoring and unsafe native numeric domains use explicit native dispatch without clearing queued work", (): void => {
  const custom = createImplicitFixture(), customWork = createImplicitRegionalDiagnostics()
  const compute = custom.computeG
  custom.computeG = function(...args: Parameters<typeof compute>): number { return compute.apply(this, args) }
  installImplicitRegionalTransitions(custom, customWork, true)
  expect(customWork.implicitUnsupportedSolvers).toBe(1)
  expect(customWork.implicitInstalledSolvers).toBe(0)
  for (const penalty of [-0.2, NaN, Infinity]) {
    const baseline = createImplicitFixture(), solver = createImplicitFixture(), work = createImplicitRegionalDiagnostics()
    for (const s of [baseline, solver]) s.problem.portPenalty![17] = penalty
    installImplicitRegionalTransitions(solver, work, true)
    expandImplicitFixture(baseline, implicitSource(0, 0))
    expandImplicitFixture(solver, implicitSource(0, 0))
    expect(solver.state.candidateQueue.toArray()).toEqual(baseline.state.candidateQueue.toArray())
    expect(work.implicitNumericNativeExpansions).toBe(1)
    expect(work.implicitFamilies).toBe(0)
  }
})
