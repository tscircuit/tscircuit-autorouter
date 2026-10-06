import { expect, test } from "bun:test"
import { Pipeline9GridDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9GridDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "tests/fixtures/pipeline9-bounded-regional-repair-fixture"

test("grid repair clears foreign pad copper without changing terminals or manufacturing dimensions", () => {
  const fixture = createBoundedRegionalRepairFixture()
  const original = structuredClone({
    routes: fixture.routes,
    originalSrj: fixture.originalSrj,
  })
  const solver = new Pipeline9GridDrcRepairSolver({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    fixedRoutes: [],
    immutableConnectionNames: fixture.syntheticConnectionNames,
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
    drcEvaluator: fixture.drcEvaluator,
    effort: 1,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.stats.gridRepairInitialDrcIssueCount).toBeGreaterThan(0)
  expect(solver.stats.gridRepairFinalDrcIssueCount).toBe(0)
  expect(solver.stats.gridRepairAcceptedCount).toBe(1)
  const output = solver.getOutput()[0]!
  expect(output.route[0]).toEqual(fixture.routes[0]!.route[0])
  expect(output.route.at(-1)).toEqual(fixture.routes[0]!.route.at(-1))
  expect(output.traceThickness).toBe(fixture.routes[0]!.traceThickness)
  expect(output.viaDiameter).toBe(fixture.routes[0]!.viaDiameter)
  expect(output.vias).toEqual(fixture.routes[0]!.vias)
  expect(fixture.routes).toEqual(original.routes)
  expect(fixture.originalSrj).toEqual(original.originalSrj)
})
