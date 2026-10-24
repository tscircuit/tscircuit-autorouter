import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { expect, test } from "bun:test"
import { createGeometricRegionalDiagnostics, installGeometricRegionalDominance } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installGeometricRegionalDominance"
import { candidateAt, createGeometricFixture, expandGeometric } from "../fixtures/tiny-geometric-dominance-fixture"

test("strict endpoint cells, same-net exclusion and exact layers preserve native common crossing costs", (): void => {
  let exercised = 0
  for (const z of [0, 1, 2, 31]) for (const [u, v, sameCell] of [[0, 1, true], [10, 11, false], [11, 12, true], [29, 30, false], [30, 31, false]] as const) {
    const native = createGeometricFixture(), optimized = createGeometricFixture()
    for (const solver of [native, optimized]) {
      solver.topology.portZ.fill(z)
      solver.topology.portZ[20] = z === 31 ? 0 : z + 1
      solver.state.currentRouteNetId = 7
      solver.appendSegmentToRegionCache(0, 10, 30)
      solver.appendSegmentToRegionCache(0, 20, 40)
      solver.state.currentRouteNetId = 0
      // Its endpoints must not split the source class: native scoring ignores
      // this completed segment because it belongs to the current net.
      solver.appendSegmentToRegionCache(0, 0, 1)
    }
    const counters = createGeometricRegionalDiagnostics()
    installGeometricRegionalDominance(optimized as unknown as TinyHyperGraphSolver, counters, true)
    if (sameCell) for (let w = 0; w < 65; w++) {
      expect(native.computeG(candidateAt(u, 0), w, Infinity, 0)).toBe(native.computeG(candidateAt(v, 0), w, Infinity, 0))
    }
    for (const [port, g] of [[u, 0], [v, 100]] as const) {
      for (const solver of [native, optimized]) expandGeometric(solver, candidateAt(port, g))
      expect(optimized.state.candidateQueue.toArray()).toEqual(native.state.candidateQueue.toArray())
      expect(optimized.state.candidateBestCostByHopId).toEqual(native.state.candidateBestCostByHopId)
    }
    expect(counters.coneDominatedExpansions).toBe(sameCell ? 1 : 0)
    exercised += counters.coneDominatedExpansions
  }
  expect(exercised).toBe(8)
})
