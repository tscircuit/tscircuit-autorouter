import { expect, test } from "bun:test"
import { IncrementalPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalPreparedPortPointRoutingSolver"
import { createIncrementalPathToy } from "./fixtures/createIncrementalPathToy"

test("unsupported prefix and arithmetic contexts choose native policy before incremental search while topology violations remain errors", (): void => {
  const make = (outsideIn: boolean): IncrementalPreparedPortPointRoutingSolver => {
    const input = createIncrementalPathToy()
    return new IncrementalPreparedPortPointRoutingSolver(input.topology, input.problem, { MAX_ITERATIONS: 100_000, STATIC_REACHABILITY_PRECHECK: false, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false, PARTIAL_RIP_ENABLED: false, OUTSIDE_IN_ROUTING: outsideIn, PARTIAL_RIP_MIN_ROUTE_COUNT: 0, PARTIAL_RIP_MAX_ROUTE_COUNT: Infinity })
  }
  const restart = (solver: IncrementalPreparedPortPointRoutingSolver): void => {
    solver.resetRoutingStateForRerip(); solver.solved = false; solver.failed = false; solver.error = null
  }
  const prefix = make(true)
  prefix.solve(); expect(prefix.solved).toBe(true)
  restart(prefix); prefix.solve(); expect(prefix.solved).toBe(true)
  expect(prefix.incrementalPath.activated).toBe(0)
  expect(prefix.incrementalPath.generatedTransitions).toBe(0)
  expect(prefix.incrementalPathScope.prefixDeclinedQueries).toBeGreaterThan(0)
  const negative = make(false)
  negative.solve(); restart(negative)
  negative.problem.portPenalty![1] = -0.01
  negative.solve(); expect(negative.solved).toBe(true)
  expect(negative.incrementalPath.activated).toBe(0)
  expect(negative.incrementalPathScope.arithmeticDeclinedQueries).toBe(1)
  const changed = make(false)
  changed.solve(); restart(changed); changed.solve(); restart(changed)
  changed.topology.incidentPortRegion[1] = [1, 0]
  expect(() => changed.solve()).toThrow("topology incidence changed")
  expect(changed.failed).toBe(true)
  const geometry = make(false)
  geometry.solve(); restart(geometry); geometry.solve(); restart(geometry)
  geometry.topology.portX[1] += 0.01
  expect(() => geometry.solve()).toThrow("static port geometry changed")
  expect(geometry.failed).toBe(true)
})
