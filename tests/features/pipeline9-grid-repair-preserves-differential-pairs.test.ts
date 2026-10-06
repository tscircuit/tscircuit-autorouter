import { expect, test } from "bun:test"
import { Pipeline9GridDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9GridDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "tests/fixtures/pipeline9-bounded-regional-repair-fixture"

test("planar grid repair leaves differential pairs to coupled solvers", () => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.originalSrj.differentialPairs = [{ connectionNames: ["signal", "signal_n"], lengthTolerance: 0.05, maxUncoupledLength: 0.5 }]
  const solver = new Pipeline9GridDrcRepairSolver({
    srj: fixture.originalSrj, routes: fixture.routes, fixedRoutes: [],
    immutableConnectionNames: fixture.syntheticConnectionNames,
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
    drcEvaluator: fixture.drcEvaluator, effort: 1,
  })
  solver.solve()
  expect(solver.getOutput()).toBe(fixture.routes)
  expect(solver.stats.gridRepairCandidateCount).toBe(0)
})
