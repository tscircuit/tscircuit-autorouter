import { expect, test } from "bun:test"
import { createCongestionFixture } from "../fixtures/congestion-rerouting"
import { CongestionReroutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CongestionReroutingSolver"

test("does not move preserved routes or forbid their terminal regions", (): void => {
  const preserved = createCongestionFixture()
  const solver = new CongestionReroutingSolver({ ...preserved, preservedRouteIds: new Set([0, 1]) })
  solver.solve()
  expect(solver.attempts).toBe(0)
  expect(solver.getOutput()).toBe(preserved.solver)

  const terminal = createCongestionFixture()
  // The hot region itself contains the horizontal net's terminal.
  terminal.solver.problem.routeStartPort[0] = 0
  const terminalSolver = new CongestionReroutingSolver({ ...terminal, preservedRouteIds: new Set([1]) })
  terminalSolver.solve()
  expect(terminalSolver.attempts).toBe(0)
  expect(terminalSolver.getOutput()).toBe(terminal.solver)
})
