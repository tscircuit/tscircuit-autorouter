import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { expect, test } from "bun:test"
import { createGeometricRegionalDiagnostics, installGeometricRegionalDominance } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installGeometricRegionalDominance"
import { candidateAt, createGeometricFixture, expandGeometric } from "../fixtures/tiny-geometric-dominance-fixture"

test("native g and lower gates, closures, reservations and duplicate directed destinations preserve ordered witnesses", (): void => {
  for (let trial = 0; trial < 30; trial++) {
    const native = createGeometricFixture(), optimized = createGeometricFixture()
    for (const solver of [native, optimized]) {
      solver.state.regionCongestionCost[0] = (trial % 3 - 1) * 0.3
      solver.topology.regionIncidentPorts[0] = [...solver.topology.regionIncidentPorts[0]!, 3, 3, 4]
      solver.state.currentRouteNetId = 1
      solver.appendSegmentToRegionCache(0, 10, 40)
      solver.state.currentRouteNetId = 0
      for (let p = 0; p < 65; p++) {
        solver.problem.portPenalty![p] = (p % 3 - 1) * 0.2
        if (p % 5 === 0) solver.problem.portSectionMask[p] = 0
        if (p % 7 === 0) solver.state.portAssignment[p] = 2
        if (p % 4 === 0) solver.setCandidateBestCost(solver.getHopId(p, 1), p % 2 ? 0 : 0.01)
      }
      solver.state.candidateQueue.queue({ ...candidateAt(8, 0, 1), hopId: solver.getHopId(8, 1) })
      solver.state.candidateQueue.dequeue()
      if (trial % 2) solver.problem.regionNetId[1] = 3
    }
    const counters = createGeometricRegionalDiagnostics()
    installGeometricRegionalDominance(optimized as unknown as TinyHyperGraphSolver, counters, true)
    for (const [port, g] of [[0, 0], [1, 2], [2, 3]] as const) {
      for (const solver of [native, optimized]) expandGeometric(solver, candidateAt(port, g))
      expect(optimized.state.candidateQueue.toArray()).toEqual(native.state.candidateQueue.toArray())
      expect(optimized.state.candidateBestCostByHopId).toEqual(native.state.candidateBestCostByHopId)
    }
    expect(counters.coneDominatedExpansions).toBe(2)
  }
})
