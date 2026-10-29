import { expect, test } from "bun:test"
import { UselessViaRemovalSolver } from "@tscircuit/trace-simplification-solver"
import { Pipeline9JointLayerAssignmentSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointLayerAssignmentSolver"
import { createCyclicJointLayerFixture, evaluateJointLayerFixture } from "tests/fixtures/joint-layer-assignment"

test("joint fixed-XY layer assignment resolves cyclic conflicts blocked by independent fixed-XY moves", (): void => {
  const { routes, srj, connMap } = createCyclicJointLayerFixture()
  const snapshot = structuredClone(routes)
  expect(evaluateJointLayerFixture(srj, routes)).toEqual({ valid: true, manufacturedSites: 6 })
  const old = new UselessViaRemovalSolver({ unsimplifiedHdRoutes: routes,
    obstacles: srj.obstacles, layerCount: 4, colorMap: {}, connMap,
    preserveRouteEndpoints: true, enableGeometryShortcuts: false,
    enableRoutedTraceDetours: false, enableObstacleDetourShortcuts: false })
  old.solve()
  expect(old.solved).toBe(true)
  expect(old.getOptimizedHdRoutes()!.reduce((n, route) => n + route.vias.length, 0)).toBe(6)
  const solver = new Pipeline9JointLayerAssignmentSolver({ routes,
    fixedRoutes: [], layerCount: 4, connMap, clearance: 0.1, obstacles: srj.obstacles,
    evaluate: (candidate) => evaluateJointLayerFixture(srj, candidate) })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats.accepted).toBeGreaterThan(0)
  expect(solver.stats.searchStates).toBeGreaterThan(0)
  expect(evaluateJointLayerFixture(srj, solver.getOutput())).toEqual({ valid: true, manufacturedSites: 0 })
  expect(solver.stats.sitesBefore).toBe(6)
  expect(solver.stats.sitesAfter).toBe(0)
  expect(routes).toEqual(snapshot)
  const length = (input: typeof routes): number => input.reduce((sum, route) => sum +
    route.route.reduce((n, point, i) => i === 0 ? n : n + Math.hypot(
      point.x - route.route[i - 1].x, point.y - route.route[i - 1].y), 0), 0)
  expect(length(solver.getOutput())).toBeCloseTo(length(snapshot), 12)
  for (const [i, route] of solver.getOutput().entries()) {
    expect(route.route[0]).toEqual(routes[i].route[0])
    expect(route.route.at(-1)).toEqual(routes[i].route.at(-1))
  }
})
