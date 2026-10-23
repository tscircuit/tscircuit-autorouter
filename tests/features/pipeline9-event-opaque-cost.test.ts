import { expect, test } from "bun:test"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/FindClearancePathSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("opaque edge costs select native grid before execution without an unsupported empty-run proof", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const route = fixture.routes[0]!
  const solver = new FindClearancePathSolver({
    srj: { ...fixture.originalSrj, traces: undefined }, routes: [route], routeIndex: 0,
    start: route.route[0]!, end: route.route.at(-1)!, bounds: fixture.originalSrj.bounds,
    traceThickness: route.traceThickness, traceClearance: 0.1, viaClearance: 0.1,
    allowLayerChanges: false, maxNodes: 10000,
    getAdditionalEdgeCost: (): number => 0,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats).toMatchObject({ searchGraph: "grid", completionReason: "found" })
  expect(solver.getOutput()![0]).toEqual(route.route[0]!)
  expect(solver.getOutput()!.at(-1)).toEqual(route.route.at(-1)!)
})
