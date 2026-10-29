import { expect, test } from "bun:test"
import { IncrementalPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalPreparedPortPointRoutingSolver"
import { createIncrementalPathToy } from "./fixtures/createIncrementalPathToy"

test("incremental graph work resumes exactly at async slices and consumes the original total budget", async (): Promise<void> => {
  const make = (): IncrementalPreparedPortPointRoutingSolver => {
    const input = createIncrementalPathToy()
    return new IncrementalPreparedPortPointRoutingSolver(input.topology, input.problem, { MAX_ITERATIONS: 100_000, STATIC_REACHABILITY_PRECHECK: false, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false, PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: false })
  }
  const synchronous = make(), asynchronous = make()
  for (const solver of [synchronous, asynchronous]) {
    solver.solve()
    expect(solver.solved).toBe(true)
    solver.resetRoutingStateForRerip(); solver.solved = false; solver.failed = false; solver.error = null
  }
  synchronous.solve()
  while (!asynchronous.solved && !asynchronous.failed) {
    const stop = asynchronous.iterations + 7
    await asynchronous.solveAsync(undefined, stop)
    expect(asynchronous.iterations).toBeLessThanOrEqual(stop)
  }
  expect(asynchronous.solved).toBe(true)
  expect(asynchronous.state.regionSegments).toEqual(synchronous.state.regionSegments)
  expect(asynchronous.incrementalPath.eligibleQueries).toBe(1)
  expect(asynchronous.incrementalPath.generatedTransitions).toBe(synchronous.incrementalPath.generatedTransitions)
  expect(asynchronous.incrementalPath.chargedWork).toBe(synchronous.incrementalPath.chargedWork)
  expect(asynchronous.iterations).toBeGreaterThanOrEqual(asynchronous.incrementalPath.chargedWork)
  const budgeted = make()
  budgeted.solve()
  budgeted.resetRoutingStateForRerip(); budgeted.solved = false; budgeted.failed = false; budgeted.error = null
  const maximum = budgeted.iterations + 70
  budgeted.MAX_ITERATIONS = maximum
  budgeted.solve()
  expect(budgeted.solved).toBe(false)
  expect(budgeted.failed).toBe(true)
  expect(budgeted.MAX_ITERATIONS).toBe(maximum)
  expect(budgeted.iterations).toBe(maximum)
  expect(budgeted.incrementalPath.generatedTransitions).toBeGreaterThan(0)
  expect(budgeted.incrementalPath.solvedQueries).toBe(0)
})
