import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver as ReferenceSolver, type NegotiatedClearanceInput } from "@tscircuit/repair04"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/NegotiateTraceClearanceSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("dirty copper worklist matches complete rebuilds while replacing only changed span geometry", (): void => {
  for (const crossed of [false, true]) {
  const fixture = createBoundedRegionalRepairFixture(4)
  if (crossed) fixture.routes.forEach((route, index): void => { route.route.at(-1)!.y = 3 - index })
  const original = structuredClone(fixture.routes)
  const input: NegotiatedClearanceInput = {
    srj: { ...fixture.originalSrj, traces: undefined }, routes: fixture.routes,
    bounds: fixture.originalSrj.bounds, dirtyRouteIndices: [0, 1, 2, 3], isLocked: (): boolean => false,
    traceClearance: 0.1, viaClearance: 0.1, allowLayerChanges: true,
    maxPathSearchCalls: 24, maxPathSearchNodes: 240000,
    maxPathSearchNodesPerCall: 10000, pathHeuristicWeight: 1.5,
  }
  const solver = new NegotiateTraceClearanceSolver(input)
  const reference = new ReferenceSolver(input)
  solver.solve()
  reference.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.getOutput()).toEqual(reference.getOutput())
  expect(solver.stats.pathSearchCalls).toBeGreaterThan(1)
  expect(solver.stats.copperGeometryBuildCount).toBeGreaterThan(0)
  expect(solver.stats.copperGeometryReuseCount).toBeGreaterThan(0)
  expect(solver.stats.pathSearchNodes).toBe(reference.stats.pathSearchNodes)
  expect(fixture.routes).toEqual(original)
  }
})
