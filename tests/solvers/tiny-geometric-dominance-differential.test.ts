import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { expect, test } from "bun:test"
import { createGeometricRegionalDiagnostics, installGeometricRegionalDominance } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installGeometricRegionalDominance"
import { candidateAt, createGeometricFixture, expandGeometric } from "../fixtures/tiny-geometric-dominance-fixture"

test("whole-family dominance preserves exact native heap and self-port exception across queue and cache epochs", (): void => {
  const native = createGeometricFixture(), optimized = createGeometricFixture()
  const counters = createGeometricRegionalDiagnostics()
  installGeometricRegionalDominance(optimized as unknown as TinyHyperGraphSolver, counters, true)
  const compare = (port: number, g: number): void => {
    for (const solver of [native, optimized]) expandGeometric(solver, candidateAt(port, g))
    expect(optimized.state.candidateQueue.toArray()).toEqual(native.state.candidateQueue.toArray())
    expect(optimized.state.candidateBestCostByHopId).toEqual(native.state.candidateBestCostByHopId)
    expect(optimized.state.candidateBestCostGenerationByHopId).toEqual(native.state.candidateBestCostGenerationByHopId)
    expect(optimized.state.regionSegments).toEqual(native.state.regionSegments)
  }
  compare(0, 0)
  compare(1, 2)
  expect(counters.coneDominatedExpansions).toBe(1)
  expect(counters.coneExceptionQueues).toBe(1)
  expect(native.getCandidateBestCost(native.getHopId(0, 1))).toBe(2.005)
  for (const solver of [native, optimized]) {
    solver.state.candidateQueue.clear()
    solver.resetCandidateBestCosts()
    solver.state.regionCongestionCost[0] = -0.1
    solver.problem.portPenalty![17] = -0.2
    solver.state.portAssignment[20] = 1
    solver.problem.portSectionMask[21] = 0
  }
  compare(0, 0)
  compare(1, 2)
  expect(counters.coneDominatedExpansions).toBe(2)
  for (const solver of [native, optimized]) {
    solver.state.regionIntersectionCaches[0] = { ...solver.state.regionIntersectionCaches[0]! }
    solver.topology.regionIncidentPorts[0] = [...solver.topology.regionIncidentPorts[0]!, 1, 1]
  }
  compare(0, 0)
  compare(1, 3)
  expect(counters.coneDominatedExpansions).toBe(3)
  expect(optimized.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect(optimized.iterations).toBe(native.iterations)
  expect(optimized.stats).toEqual(native.stats)
})
