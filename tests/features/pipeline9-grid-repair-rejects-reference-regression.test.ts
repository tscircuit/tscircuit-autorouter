import { expect, test } from "bun:test"
import { Pipeline9GridDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9GridDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "tests/fixtures/pipeline9-bounded-regional-repair-fixture"

test("grid repair rejects a geometrically legal detour when reference DRC does not improve", () => {
  const fixture = createBoundedRegionalRepairFixture()
  let validations = 0
  const solver = new Pipeline9GridDrcRepairSolver({
    srj: fixture.originalSrj, routes: fixture.routes, fixedRoutes: [],
    immutableConnectionNames: fixture.syntheticConnectionNames,
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
    drcEvaluator: () => {
      validations++
      return [{ type: "pcb_trace_error", pcb_trace_id: "signal_0", message: "Persistent violation" }]
    }, effort: 1,
  })
  solver.solve()
  expect(validations).toBe(2)
  expect(solver.getOutput()).toBe(fixture.routes)
  expect(solver.stats.gridRepairCandidateCount).toBe(1)
  expect(solver.stats.gridRepairAcceptedCount).toBe(0)
})
