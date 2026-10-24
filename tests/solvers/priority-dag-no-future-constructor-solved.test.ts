import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("no-future native constructor solved paths remain private until charged pair and full witness validation", () => detailedPriority(() => {
  const solver = new PriorityDagIntraNodeSolver({ ...priorityParams(), predictFutureConnections: false })
  solver.step()
  expect(solver.activeSubSolver?.solved).toBe(true)
  expect(solver.priorityDiagnostics.priorityNativeConstructorSolved).toBe(1)
  expect(solver.activeSubSolver?.solvedPath).not.toBeNull()
  expect(solver.solved).toBe(false)
  expect(solver.solvedRoutes).toEqual([])
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes).toHaveLength(3)
  expect(solver.priorityDiagnostics.priorityNativeFutureConnections).toBe(0)
  expect(solver.priorityDiagnostics.priorityObservedConflicts).toBeGreaterThan(0)
  expect(solver.priorityDiagnostics.priorityWitnessesRetained).toBeGreaterThan(0)
  expect(solver.priorityDiagnostics.priorityFinalSegmentChecks).toBeGreaterThan(0)
  expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
}))
