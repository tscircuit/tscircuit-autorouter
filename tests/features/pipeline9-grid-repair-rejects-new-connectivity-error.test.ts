import { expect, test } from "bun:test"
import { Pipeline9GridDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9GridDrcRepairSolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "tests/fixtures/pipeline9-bounded-regional-repair-fixture"

test("a lower DRC count cannot publish a new missing connection", () => {
  const fixture = createBoundedRegionalRepairFixture()
  let validations = 0
  const solver = new Pipeline9GridDrcRepairSolver({
    srj: fixture.originalSrj,
    routes: fixture.routes,
    fixedRoutes: [],
    immutableConnectionNames: fixture.syntheticConnectionNames,
    connMap: getConnectivityMapFromSimpleRouteJson(fixture.originalSrj),
    drcEvaluator: () => {
      validations++
      return validations === 1
        ? [0, 1, 2].map((index) => ({
            type: "pcb_trace_error",
            pcb_trace_id: "signal_0",
            message: `Collision ${index}`,
          }))
        : [
            {
              type: "pcb_trace_error",
              pcb_trace_id: "signal_0",
              pcb_trace_error_id: "missing_connection_signal_0_end",
              message: "Missing connection",
            },
          ]
    },
    effort: 1,
  })
  solver.solve()
  expect(validations).toBe(2)
  expect(solver.getOutput()).toBe(fixture.routes)
  expect(solver.stats.gridRepairFinalDrcIssueCount).toBe(3)
  expect(solver.stats.gridRepairAcceptedCount).toBe(0)
})
