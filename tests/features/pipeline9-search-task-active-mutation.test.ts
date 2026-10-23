import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/NegotiateTraceClearanceSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("an externally mutated active repair input throws before it can become a reusable completed task", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const solver = new NegotiateTraceClearanceSolver({
    srj: { ...fixture.originalSrj, traces: undefined }, routes: fixture.routes,
    bounds: fixture.originalSrj.bounds, dirtyRouteIndices: [0],
    isLocked: (): boolean => false, traceClearance: 0.1, viaClearance: 0.1,
    allowLayerChanges: true, maxPathSearchCalls: 4, maxPathSearchNodes: 20000,
    maxPathSearchNodesPerCall: 10000,
  })
  while (!solver.activeSubSolver && !solver.solved && !solver.failed) solver.step()
  expect(solver.activeSubSolver).toBeDefined()
  fixture.originalSrj.obstacles[2]!.center.x += 0.01
  expect(() => solver.solve()).toThrow("inputs changed during an active dependency task")
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.searchTaskWorklist.getStats().searchTaskStoredCount).toBe(0)
})
