import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("DAG setup, branching, native search and final validation share only the removed family's allowance", () => detailedPriority(() => {
  const params = priorityParams(), native = new IntraNodeRouteSolver(params), solver = new PriorityDagIntraNodeSolver(params)
  expect(solver.MAX_ITERATIONS + 1).toBe((Math.floor(native.MAX_ITERATIONS) + 1) * params.priorityFamilySize)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.iterations).toBe(solver.priorityDiagnostics.priorityWorkUnits)
  expect(solver.iterations).toBeLessThanOrEqual(solver.MAX_ITERATIONS)
  expect(solver.priorityDiagnostics.priorityNativeSteps).toBeGreaterThan(0)
  expect(solver.priorityDiagnostics.priorityContextEntries).toBeGreaterThan(0)
  expect(solver.priorityDiagnostics.priorityClosureInsertions).toBeGreaterThan(0)
  expect(solver.priorityDiagnostics.priorityPairPrimitiveUpperBound).toBeGreaterThan(0)
  expect(solver.priorityDiagnostics.priorityWitnessVertices).toBeGreaterThan(0)
  const capped = new PriorityDagIntraNodeSolver(params)
  const cap = capped.iterations + 40
  capped.MAX_ITERATIONS = cap
  capped.solve()
  expect(capped.solved).toBe(false)
  expect(capped.failed).toBe(true)
  expect(capped.error).toContain("UNKNOWN")
  expect(capped.error).not.toContain("UNSAT")
  expect(capped.iterations).toBeLessThanOrEqual(cap)
  if (capped.activeSubSolver) expect(capped.activeSubSolver.MAX_ITERATIONS).toBe(10000)
}))
