import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { createPreparedRoutingFixture } from "tiny-hypergraph/tests/fixtures/createPreparedRoutingFixture"
import { IncrementalPreparedPortPointRoutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/IncrementalPreparedPortPointRoutingSolver"

test("actual prepared native queries stay cold first then repair changed costs with retained nonterminal labels", (): void => {
  const input = createPreparedRoutingFixture()
  const options = { ...input.options, MAX_ITERATIONS: 500_000 }
  const before = structuredClone({ topology: input.topology, problem: input.problem })
  const native = new PreparedPortPointRoutingSolver(input.topology, input.problem, options)
  native.solve()
  const solver = new IncrementalPreparedPortPointRoutingSolver(input.topology, input.problem, options)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.state.regionSegments).toEqual(native.state.regionSegments)
  expect(solver.incrementalPath.queryStarts).toBe(8)
  expect(solver.incrementalPath.activated).toBe(0)
  expect(solver.incrementalPath.generatedTransitions).toBe(0)
  const restart = (): void => {
    solver.resetRoutingStateForRerip()
    solver.solved = false; solver.failed = false; solver.error = null
  }
  restart(); solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.incrementalPath.freshSearches).toBe(8)
  expect(solver.incrementalPath.repairs).toBe(0)
  expect(solver.incrementalPath.changedCostReuseQueries).toBe(0)
  restart()
  solver.problem.portPenalty = new Float64Array(input.topology.portCount)
  solver.problem.portPenalty[3] = 0.1
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.incrementalPath.repairs).toBe(8)
  expect(solver.incrementalPath.changedTransitions).toBeGreaterThan(0)
  expect(solver.incrementalPath.reusedLabels).toBeGreaterThan(0)
  expect(solver.incrementalPath.changedCostReuseQueries).toBeGreaterThan(0)
  expect(solver.incrementalPathScope.changedRepairQueries).toBeGreaterThan(0)
  expect(solver.incrementalPathScope.changedRepairReusedLabels).toBeGreaterThan(0)
  expect(solver.incrementalPath.repairedLabels).toBeGreaterThan(0)
  expect(solver.incrementalPath.chargedWork).toBeGreaterThan(solver.incrementalPath.generatedTransitions)
  expect(solver.iterations).toBeGreaterThanOrEqual(solver.incrementalPath.chargedWork)
  expect(input.topology).toEqual(before.topology)
  expect(before.problem.portPenalty).toBeUndefined()
})
