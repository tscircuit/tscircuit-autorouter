import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "tests/fixtures/pipeline9-bounded-regional-repair-fixture"

test("joint repair moves copper to a stricter target without changing board rules", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  srj.minTraceToPadEdgeClearance = 0.05
  srj.obstacles[2]!.center.y = 0.33
  const original = JSON.stringify(srj)
  const initial = fixture.drcEvaluator({
    routes: fixture.routes,
    hdRoutes: fixture.routes,
    traces: [],
  })
  expect(Array.isArray(initial) ? initial : initial.errors).toHaveLength(1)
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: fixture.routes,
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    targetTraceClearance: 0.1,
    effort: 1,
    colorMap: {},
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const routes = solver.getOutput()
  const result = fixture.drcEvaluator({ routes, hdRoutes: routes, traces: [] })
  expect(Array.isArray(result) ? result : result.errors).toHaveLength(0)
  expect(JSON.stringify(srj)).toBe(original)
  expect(routes[0]!.route[0]).toEqual(fixture.routes[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(fixture.routes[0]!.route.at(-1))
  expect(routes[0]!.traceThickness).toBe(0.1)
  expect(routes[0]!.viaDiameter).toBe(0.3)
})
