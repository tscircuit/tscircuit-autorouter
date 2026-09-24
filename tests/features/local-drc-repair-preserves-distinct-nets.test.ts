import { expect, test } from "bun:test"
import { LocalDrcRepairSolver } from "lib/solvers/LocalDrcRepairSolver/LocalDrcRepairSolver"
import { createLocalDrcRepairFixture } from "../fixtures/local-drc-repair-fixture"

test("overlapping vias on distinct explicit nets are never consolidated", (): void => {
  const input = createLocalDrcRepairFixture()
  input.traces[1]!.connection_name = "independent"
  input.originalSrj.connections.push({
    name: "independent",
    pointsToConnect: [],
  })
  const original = structuredClone(input.traces.slice(0, 2))
  const solver = new LocalDrcRepairSolver(input)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.stats.mergedViaGroups).toBe(0)
  expect(solver.getOutput().slice(0, 2)).toEqual(original)
})
