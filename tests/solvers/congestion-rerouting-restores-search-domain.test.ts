import { expect, test } from "bun:test"
import { createCongestionFixture } from "../fixtures/congestion-rerouting"
import { CongestionReroutingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/CongestionReroutingSolver"

test("finds a detour outside an exhausted optimizer section", (): void => {
  const input = createCongestionFixture()
  const originalMask = new Int8Array(input.solver.problem.portSectionMask)
  input.solver.problem.portSectionMask.fill(0)
  const solver = new CongestionReroutingSolver({
    ...input,
    portSectionMask: originalMask,
  })
  solver.solve()
  expect(solver.accepted).toBe(1)
  expect(solver.stats.maxPf).toBe(0)
  expect(
    solver.getOutput().state.regionSegments[0].map(([routeId]) => routeId),
  ).toEqual([1])
  expect(
    [...input.solver.problem.portSectionMask].every((value) => value === 0),
  ).toBe(true)
})
