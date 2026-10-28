import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver as Priority } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("lean priority routing has identical work policy while detailed instrumentation stays opt-in", () => {
  const previous = Priority.detailedWorkDiagnostics
  try {
    Priority.detailedWorkDiagnostics = false
    const lean = new Priority(priorityParams())
    Priority.detailedWorkDiagnostics = true
    const detailed = new Priority(priorityParams())
    lean.solve()
    detailed.solve()
    expect(lean.detailedWorkDiagnosticsEnabled).toBe(false)
    expect(detailed.detailedWorkDiagnosticsEnabled).toBe(true)
    expect(lean.solvedRoutes).toEqual(detailed.solvedRoutes)
    expect(lean.iterations).toBe(detailed.iterations)
    expect(lean.priorityDiagnostics.priorityNativeSteps).toBeUndefined()
    expect(lean.priorityDiagnostics.priorityCompletedWorkUnits).toBe(
      lean.iterations,
    )
    expect(lean.priorityDiagnostics.prioritySolvedCandidates).toBe(1)
    expect(detailed.priorityDiagnostics.priorityNativeSteps).toBeGreaterThan(0)
  } finally {
    Priority.detailedWorkDiagnostics = previous
  }
})
