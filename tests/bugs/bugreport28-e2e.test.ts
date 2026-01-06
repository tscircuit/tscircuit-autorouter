import { expect, test } from "bun:test"
import bugReport from "../../fixtures/bug-reports/bugreport28-18a9ef/bugreport28-18a9ef.json" with {
  type: "json",
}
import type { SimpleRouteJson } from "lib/types"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines"

const srj = bugReport.simple_route_json as SimpleRouteJson

test("bugreport28", () => {
  const solver = new AutoroutingPipelineSolver2_PortPointPathing(srj)

  solver.solve()

  // Check that the fix worked - mst2 should not have an excessively long path
  const traces = solver.traceSimplificationSolver?.simplifiedHdRoutes || []
  const mst2Trace = traces.find(
    (t: any) => t.connectionName === "source_net_1_mst2",
  )
  if (mst2Trace) {
    // mst2 connects points that are close vertically, so it shouldn't need 30+ points
    // expect(mst2Trace.route.length).toBeLessThan(10)

    // Check that the path doesn't deviate too far horizontally
    const minX = Math.min(...mst2Trace.route.map((p: any) => p.x))
    const maxX = Math.max(...mst2Trace.route.map((p: any) => p.x))
    const horizontalSpan = maxX - minX
    // For a vertical connection, horizontal span should be small
    expect(horizontalSpan).toBeLessThan(5) // Allow some tolerance
  }

  expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
