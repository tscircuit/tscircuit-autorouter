import { expect, test } from "bun:test"
import { createCongestionFixture } from "../fixtures/congestion-rerouting"
import { CongestionReroutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CongestionReroutingSolver"

test("invalid committed state is fatal rather than treated as failed route search", (): void => {
  const input = createCongestionFixture()
  input.solver.state.regionSegments[3] = []
  const solver = new CongestionReroutingSolver(input)
  expect(() => solver.solve()).toThrow(
    "Initial assignments for route 1 do not connect",
  )
  expect(solver.failed).toBe(true)
  expect(() => solver.getOutput()).toThrow("before successful completion")
})
