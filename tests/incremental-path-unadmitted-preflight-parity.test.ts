import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { IncrementalPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalPreparedPortPointRoutingSolver"
import { createIncrementalPathToy } from "./fixtures/createIncrementalPathToy"

test("declined arithmetic or setup-budget admission preserves native route state and iterations after real repeated-query preflight", (): void => {
  for (const reason of ["arithmetic", "setup-budget"] as const) {
    const baselineInput = createIncrementalPathToy(), experimentInput = createIncrementalPathToy()
    const options = { MAX_ITERATIONS: 100_000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false }
    const native = new PreparedPortPointRoutingSolver(baselineInput.topology, baselineInput.problem, options)
    const experimental = new IncrementalPreparedPortPointRoutingSolver(experimentInput.topology, experimentInput.problem, options)
    for (const solver of [native, experimental]) {
      solver.solve(); expect(solver.solved).toBe(true)
      solver.resetRoutingStateForRerip(); solver.solved = false; solver.failed = false; solver.error = null
      if (reason === "arithmetic") solver.problem.portPenalty![1] = -0.01
      else solver.MAX_ITERATIONS = solver.iterations + 70
    }
    native.solve(); experimental.solve()
    expect(experimental.solved).toBe(native.solved)
    expect(experimental.failed).toBe(native.failed)
    expect(experimental.iterations).toBe(native.iterations)
    expect(experimental.state).toEqual(native.state)
    const { incrementalPath, incrementalPathScope, ...nativeStats } = experimental.stats
    expect(nativeStats).toEqual(native.stats)
    expect(experimental.incrementalPath.generatedTransitions).toBeGreaterThan(0)
    expect(experimental.incrementalPath.activated).toBe(0)
    expect(experimental.incrementalPath.chargedWork).toBe(0)
    if (reason === "arithmetic") expect(experimental.incrementalPathScope.arithmeticDeclinedQueries).toBe(1)
    else expect(experimental.incrementalPath.budgetDeclinedQueries).toBe(1)
  }
})
