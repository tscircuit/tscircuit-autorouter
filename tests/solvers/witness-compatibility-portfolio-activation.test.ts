import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("ordinary priority portfolio enables shared witness selection and supports an explicit local ablation", () => {
  const diagnostics: Record<string, number> = {}
  const portfolio = new PortfolioSingleIntraNodeSolver({ ...priorityParams(), priorityDagSearch: true, priorityDiagnostics: diagnostics })
  const first = portfolio.generateSolver({ PRIORITY_DAG_FAMILY_SIZE: 6 })
  first.solve()
  expect(first.solved).toBe(true)
  expect(diagnostics.witnessCompatibilityAcceptedAssignments).toBe(1)
  const second = portfolio.generateSolver({ PRIORITY_DAG_FAMILY_SIZE: 20, MISALIGNED_DIST_PENALTY_FACTOR: 2 })
  second.solve()
  expect(second.solved).toBe(true)
  expect(diagnostics.witnessCatalogInstances).toBe(1)
  expect(diagnostics.witnessCompatibilityAcceptedAssignments).toBe(2)
  const originalDiagnostics: Record<string, number> = {}
  const disabled = new PortfolioSingleIntraNodeSolver({
    ...priorityParams(), priorityDagSearch: true,
    priorityDiagnostics: originalDiagnostics, enableWitnessCompatibility: false,
  }).generateSolver({ PRIORITY_DAG_FAMILY_SIZE: 6 })
  disabled.solve()
  expect(disabled.solved).toBe(true)
  expect(originalDiagnostics.witnessCatalogInstances).toBeUndefined()
})
