import { expect, test } from "bun:test"
import { Pipeline9GridDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9GridDrcRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { createBoundedRegionalRepairFixture } from "tests/fixtures/pipeline9-bounded-regional-repair-fixture"

test("a through via blocks copper even on a layer absent from its route points", () => {
  const fixture = createBoundedRegionalRepairFixture()
  const fixed: HighDensityRoute = {
    connectionName: "foreign_via",
    traceThickness: 0.1,
    viaDiameter: 1.2,
    route: [{ x: 0, y: -0.4, z: 1 }],
    vias: [{ x: 0, y: -0.4 }],
  }
  const before = structuredClone(fixed)
  const solver = new Pipeline9GridDrcRepairSolver({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    fixedRoutes: [fixed],
    immutableConnectionNames: fixture.syntheticConnectionNames,
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
    drcEvaluator: fixture.drcEvaluator,
    effort: 1,
  })
  solver.solve()
  expect(solver.stats.gridRepairAcceptedCount).toBe(1)
  const points = solver.getOutput()[0]!.route
  for (let index = 1; index < points.length; index++) {
    expect(
      minimumDistanceBetweenSegments(
        points[index - 1]!,
        points[index]!,
        fixed.vias[0]!,
        fixed.vias[0]!,
      ),
    ).toBeGreaterThanOrEqual(0.75)
  }
  expect(fixed).toEqual(before)
})
