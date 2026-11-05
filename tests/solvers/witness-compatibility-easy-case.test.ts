import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("an ordinary easy complete context does not pay for duplicate CSP or board validation", () => {
  const params = priorityParams()
  const diagnostics: Record<string, number> = {}
  params.nodeWithPortPoints.portPoints = ["a", "b", "c"].flatMap((connectionName, index) => [
    { connectionName, rootConnectionName: `root-${connectionName}`, x: -2, y: index - 1, z: 0 },
    { connectionName, rootConnectionName: `root-${connectionName}`, x: 2, y: index - 1, z: 0 },
  ])
  const solver = new PriorityDagIntraNodeSolver({ ...params, priorityDiagnostics: diagnostics, witnessCompatibilitySession: {} })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(diagnostics.witnessCatalogPaths).toBe(3)
  expect(diagnostics.witnessCompatibilitySelections).toBeUndefined()
  expect(diagnostics.witnessCompatibilityBoardValidations).toBeUndefined()
  expect(diagnostics.witnessCompatibilityAcceptedAssignments).toBeUndefined()
})
