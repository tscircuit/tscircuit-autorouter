import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("the priority-DAG low-level searches inherit the same opt-in and shared diagnostics", (): void => {
  const diagnostics: Record<string, number> = {}
  const solver = new PriorityDagIntraNodeSolver({
    ...priorityParams(),
    experimentSearchState: true,
    searchStateDiagnostics: diagnostics,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(diagnostics.searchStateLowLevelInstances).toBeGreaterThan(0)
  expect(solver.priorityDiagnostics.prioritySolvedCandidates).toBe(1)
  expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
})
