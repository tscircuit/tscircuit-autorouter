import { expect, test } from "bun:test"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import type { RouteWitnessCompatibilitySession } from "lib/solvers/HighDensitySolver/RouteWitnessCompatibilityCatalog"
import { priorityParams } from "./priorityDagTestUtils"

test("virtual growth never compares scaled proposals with unscaled board obstacles", () => {
  const params = priorityParams()
  const diagnostics: Record<string, number> = {}
  const session: RouteWitnessCompatibilitySession = {}
  const ordinary = new PriorityDagIntraNodeSolver({ ...params, priorityCoordinateScale: 2 })
  const experiment = new PriorityDagIntraNodeSolver({
    ...params, priorityCoordinateScale: 2,
    priorityDiagnostics: diagnostics, witnessCompatibilitySession: session,
    obstacles: [{ type: "rect", layers: ["top"], center: { x: 0, y: 0 }, width: 20, height: 20, connectedTo: [] }],
  })
  ordinary.solve()
  experiment.solve()
  expect(experiment.solved).toBe(ordinary.solved)
  expect(experiment.iterations).toBe(ordinary.iterations)
  expect(experiment.solvedRoutes).toEqual(ordinary.solvedRoutes)
  expect(session.catalog).toBeUndefined()
  expect(diagnostics.witnessCompatibilitySkippedVirtualCandidates).toBe(1)
  expect(diagnostics.witnessCompatibilityBoardValidations).toBeUndefined()
})
