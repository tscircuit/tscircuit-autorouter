import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { detailedPriority, priorityParams } from "./priorityDagTestUtils"

test("detailed work accounting does not double-count catalog pair queries or master visits", () => {
  const diagnostics: Record<string, number> = {}
  detailedPriority(() => {
    const solver = new PriorityDagIntraNodeSolver({
      ...priorityParams(), priorityDiagnostics: diagnostics,
      witnessCompatibilitySession: {},
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(diagnostics.witnessCompatibilityPairQueries).toBeGreaterThan(0)
    expect(diagnostics.witnessCompatibilityPairQueries).toBe(diagnostics.witnessCompatibilityPairQueryWork)
    expect(diagnostics.witnessCompatibilitySelectionVisits).toBe(diagnostics.witnessCompatibilitySelectionVisitWork)
    expect(solver.iterations).toBe(diagnostics.priorityWorkUnits)
  })
})
