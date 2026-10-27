import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { priorityParams } from "./priorityDagTestUtils"

test("unpriced candidate generation preserves Native future-trace and terminal guards and original publication options", () => {
  const params = {
    ...priorityParams(), copperCandidateSearch: true,
    hyperParameters: { FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 7, FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 3 },
  }
  const solver = new PriorityDagIntraNodeSolver(params)
  const state = {
    ancestors: [new Set<number>(), new Set<number>(), new Set<number>()],
    witnesses: Array(3).fill(undefined),
  }
  Reflect.get(solver, "startTask").call(solver, 2, state)
  const oracle = solver.activeSubSolver as Native
  expect(oracle.futureConnections).toHaveLength(2)
  expect(oracle.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR).toBe(0)
  expect(oracle.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR).toBe(0)
  const node = { x: 0, y: 0, z: 0, g: 0, h: 0, f: 0, parent: null }
  expect(oracle.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
  expect(oracle.isNodeTooCloseToObstacle(node, undefined, true)).toBe(true)
  const publication = Reflect.get(solver, "getOptions").call(solver, 2, state)
  expect(publication.futureConnections).toHaveLength(2)
  expect(publication.hyperParameters.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR).toBe(7)
  expect(publication.hyperParameters.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR).toBe(3)
  expect(params.hyperParameters.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR).toBe(7)
})
