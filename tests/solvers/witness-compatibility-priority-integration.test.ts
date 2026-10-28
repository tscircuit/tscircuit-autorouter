import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { RouteWitnessCompatibilitySession } from "lib/solvers/HighDensitySolver/RouteWitnessCompatibilityCatalog"
import { priorityParams } from "./priorityDagTestUtils"

test("existing priority generators share a physical route-choice catalog and charge its work", () => {
  const diagnostics: Record<string, number> = {}
  const session: RouteWitnessCompatibilitySession = {}
  const first = new PriorityDagIntraNodeSolver({ ...priorityParams(), priorityDiagnostics: diagnostics, witnessCompatibilitySession: session })
  first.solve()
  expect(first.solved).toBe(true)
  expect(first.failed).toBe(false)
  expect(diagnostics.witnessCompatibilityAcceptedAssignments).toBe(1)
  expect(diagnostics.witnessCompatibilityCrossContextAssignments).toBe(1)
  expect(diagnostics.witnessCompatibilityBoardValidationIssues).toBe(0)
  expect(diagnostics.witnessCompatibilityPairCacheHits).toBeGreaterThan(0)
  expect(first.iterations).toBeLessThan(first.MAX_ITERATIONS)
  const second = new PriorityDagIntraNodeSolver({ ...priorityParams(), priorityDiagnostics: diagnostics, witnessCompatibilitySession: session })
  second.solve()
  expect(second.solved).toBe(true)
  expect(diagnostics.witnessCatalogInstances).toBe(1)
  expect(diagnostics.witnessCompatibilityAcceptedAssignments).toBe(2)
  expect(second.iterations).toBeLessThan(first.iterations)
  const priorX = first.solvedRoutes[0]!.route[0]!.x
  second.solvedRoutes[0]!.route[0]!.x = 99
  expect(first.solvedRoutes[0]!.route[0]!.x).toBe(priorX)
  const capped = new PriorityDagIntraNodeSolver({ ...priorityParams(), witnessCompatibilitySession: {} })
  capped.MAX_ITERATIONS = capped.iterations + 10
  capped.solve()
  expect(capped.solved).toBe(false)
  expect(capped.error).toContain("UNKNOWN")
  expect(capped.error).not.toContain("UNSAT")
})
