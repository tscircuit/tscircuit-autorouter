import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { expect, test } from "bun:test"
import { createGeometricRegionalDiagnostics, installGeometricRegionalDominance } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/installGeometricRegionalDominance"
import { candidateAt, createGeometricFixture, expandGeometric } from "../fixtures/tiny-geometric-dominance-fixture"

test("nonfinite source or foreign endpoint angles exclude numerical classification before binary search", (): void => {
  for (const invalidForeign of [false, true]) {
    const native = createGeometricFixture(), optimized = createGeometricFixture()
    for (const solver of [native, optimized]) {
      if (invalidForeign) {
        solver.state.currentRouteNetId = 1
        solver.appendSegmentToRegionCache(0, 10, 30)
        solver.state.currentRouteNetId = 0
        const cache = solver.state.regionIntersectionCaches[0]!
        // Intentional invalid external numeric-array replacement, outside the
        // native immutable typed metadata domain. It must never be certified.
        cache.lesserAngles = Float64Array.from(cache.lesserAngles, () => NaN) as unknown as Int32Array
      } else {
        solver.topology.portAngleForRegion1 = Float64Array.from(solver.topology.portAngleForRegion1, (_, i) => i < 2 ? NaN : i * 100) as unknown as Int32Array
      }
    }
    const counters = createGeometricRegionalDiagnostics()
    installGeometricRegionalDominance(optimized as unknown as TinyHyperGraphSolver, counters, true)
    for (const [p, g] of [[0, 0], [1, 2]] as const) {
      for (const solver of [native, optimized]) expandGeometric(solver, candidateAt(p, g))
      expect(optimized.state.candidateQueue.toArray()).toEqual(native.state.candidateQueue.toArray())
    }
    expect(counters.coneDominatedExpansions).toBe(0)
    expect(counters.coneNumericExcluded).toBe(2)
  }
})
