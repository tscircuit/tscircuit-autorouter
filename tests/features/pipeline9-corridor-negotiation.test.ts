import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/NegotiateTraceClearanceSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("regional negotiation uses corridor searches and preserves terminal geometry and physical clearance", (): void => {
  const fixture = createBoundedRegionalRepairFixture(4)
  const solver = new NegotiateTraceClearanceSolver({
    srj: { ...fixture.originalSrj, traces: undefined }, routes: fixture.routes,
    bounds: fixture.originalSrj.bounds, dirtyRouteIndices: [0, 1, 2, 3], isLocked: (): boolean => false,
    traceClearance: 0.15, viaClearance: 0.15, allowLayerChanges: true,
    maxPathSearchCalls: 24, maxPathSearchNodes: 240000, maxPathSearchNodesPerCall: 10000,
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.corridorSearchCalls).toBeGreaterThan(0)
  const output = solver.getOutput()
  for (let index = 0; index < fixture.routes.length; index++) {
    expect(output.routes[index]!.route[0]).toEqual(fixture.routes[index]!.route[0])
    expect(output.routes[index]!.route.at(-1)).toEqual(fixture.routes[index]!.route.at(-1))
  }
  const validation = fixture.drcEvaluator({ traces: [], routes: output.routes })
  expect(Array.isArray(validation) ? validation : validation.errors).toHaveLength(0)
  expect(output.pathSearchNodes).toBeLessThanOrEqual(240000)
})
