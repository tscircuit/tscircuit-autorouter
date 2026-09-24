import { expect, test } from "bun:test"
import { LocalDrcRepairSolver } from "lib/solvers/LocalDrcRepairSolver/LocalDrcRepairSolver"
import { createLocalDrcRepairFixture, localWire } from "../fixtures/local-drc-repair-fixture"

test("a local move cannot exchange its clearance error for a neighboring copper conflict", (): void => {
  const input = createLocalDrcRepairFixture()
  input.traces.push({ type: "pcb_trace", pcb_trace_id: "neighbor", connection_name: "neighbor", route: [localWire(-1, 4.49), localWire(1, 4.49)] })
  const before = structuredClone(input.traces[3]!)
  const solver = new LocalDrcRepairSolver(input)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.stats.attemptedClearanceMoves).toBeGreaterThan(0)
  expect(solver.getOutput()[3]).toEqual(before)
  expect(solver.stats.mergedViaGroups).toBe(1)
})
