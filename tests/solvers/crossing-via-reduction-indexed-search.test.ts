import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { CrossingViaReductionSolver } from "lib/solvers/CrossingViaReductionSolver/crossing-via-reduction-solver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const createSeparatedDetours = (count: number): HighDensityRoute[] => {
  return Array.from({ length: count }, (_, index) => {
    const x = index * 5
    return {
      connectionName: `detour_${index}`,
      traceThickness: 0.15,
      viaDiameter: 0.4,
      route: [
        { x, y: 0, z: 0 },
        { x: x + 1, y: 0, z: 0 },
        { x: x + 1, y: 0, z: 1 },
        { x: x + 1, y: 1, z: 1 },
        { x: x + 1, y: 1, z: 0 },
        { x: x + 2, y: 1, z: 0 },
      ],
      vias: [
        { x: x + 1, y: 0 },
        { x: x + 1, y: 1 },
      ],
    }
  })
}

test("indexes crossing candidates instead of scanning every route pair", () => {
  const routeCount = 1000
  const solver = new CrossingViaReductionSolver({
    inputHdRoutes: createSeparatedDetours(routeCount),
    obstacles: [],
    connMap: new ConnectivityMap({}),
    layerCount: 2,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBe(1)
  expect(solver.stats.transitionSegmentsIndexed).toBe(routeCount * 2)
  expect(solver.stats.indexedDetourSegmentQueries).toBe(routeCount)
  expect(solver.stats.exactSegmentIntersectionChecks ?? 0).toBe(0)
  expect(solver.timeToSolve).toBeLessThan(1000)
  expect(solver.getReducedHdRoutes().every((route) => route.vias.length === 2)).toBe(
    true,
  )
})
