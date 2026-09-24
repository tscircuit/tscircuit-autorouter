import { expect, test } from "bun:test"
import { LocalDrcRepairSolver } from "lib/solvers/LocalDrcRepairSolver/LocalDrcRepairSolver"
import { createLocalDrcRepairFixture } from "../fixtures/local-drc-repair-fixture"

test("local cleanup debugger renders repaired copper and exposes reproducible inputs", (): void => {
  const input = createLocalDrcRepairFixture()
  const solver = new LocalDrcRepairSolver(input)
  expect(solver.getConstructorParams()).toEqual([input])
  expect(() => solver.getOutput()).toThrow("before solving")
  expect(solver.visualize().lines!.length).toBeGreaterThan(0)
  solver.solve()
  expect(solver.visualize().lines!.length).toBeGreaterThan(0)
  expect(solver.visualize().circles!.length).toBeGreaterThan(0)
})
