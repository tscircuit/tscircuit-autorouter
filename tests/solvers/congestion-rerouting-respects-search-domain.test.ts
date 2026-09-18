import { expect, test } from "bun:test"
import { createCongestionFixture } from "../fixtures/congestion-rerouting"
import { CongestionReroutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CongestionReroutingSolver"

test("does not reopen ports forbidden by the original search domain", (): void => {
  const input = createCongestionFixture(true)
  const originalMask = new Int8Array(input.solver.problem.portSectionMask)
  input.solver.problem.portSectionMask.fill(0)
  const solver = new CongestionReroutingSolver({ ...input, portSectionMask: originalMask })
  solver.solve()
  expect(solver.accepted).toBe(0)
  expect(solver.getOutput()).toBe(input.solver)
  expect(originalMask[8]).toBe(0)
  expect(originalMask[9]).toBe(0)
})
