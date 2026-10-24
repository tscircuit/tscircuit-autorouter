import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { expect, test } from "bun:test"
import { createGeometricRegionalDiagnostics, installGeometricRegionalDominance } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installGeometricRegionalDominance"
import { candidateAt, createGeometricFixture, expandGeometric } from "../fixtures/tiny-geometric-dominance-fixture"

test("goals, custom scorers, unsafe native distance overflow and mutable-array replacement retain native policy", (): void => {
  const native = createGeometricFixture(), optimized = createGeometricFixture()
  const counters = createGeometricRegionalDiagnostics()
  installGeometricRegionalDominance(optimized as unknown as TinyHyperGraphSolver, counters, true)
  for (const solver of [native, optimized]) {
    solver.state.goalPortId = 5
    solver.problem.portSectionMask[5] = 0
  }
  for (const port of [0, 1]) for (const solver of [native, optimized]) expandGeometric(solver, candidateAt(port, port * 2))
  expect(counters.coneGoalExcluded).toBe(2)
  expect(counters.coneDominatedExpansions).toBe(0)
  expect(optimized.state.candidateQueue.toArray()).toEqual(native.state.candidateQueue.toArray())
  for (const solver of [native, optimized]) {
    solver.state.goalPortId = 65
    solver.state.candidateQueue.clear()
    solver.resetCandidateBestCosts()
    solver.topology.portX = Float64Array.from(solver.topology.portX, x => x * 1e154)
    solver.DISTANCE_TO_COST = 1e-154
  }
  for (const port of [0, 1]) for (const solver of [native, optimized]) expandGeometric(solver, candidateAt(port, port * 2))
  expect(counters.coneNumericExcluded).toBe(2)
  expect(optimized.state.candidateQueue.toArray()).toEqual(native.state.candidateQueue.toArray())
  const custom = createGeometricFixture(), customCounters = createGeometricRegionalDiagnostics()
  custom.computeG = (): number => 0
  installGeometricRegionalDominance(custom as unknown as TinyHyperGraphSolver, customCounters, true)
  expect(customCounters.coneCustomSolvers).toBe(1)
  expect(customCounters.coneInstalledSolvers).toBe(0)
})
