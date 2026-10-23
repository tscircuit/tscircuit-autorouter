import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver as NativeNegotiation, type NegotiatedClearanceInput } from "@tscircuit/repair04"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/NegotiateTraceClearanceSolver"
import { ClearanceSearchTaskWorklist } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/ClearanceSearchTaskWorklist"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("repeated repair passes skip completed unchanged search tasks without changing native output or effort coverage", (): void => {
  const fixture = createBoundedRegionalRepairFixture(4)
  const input: NegotiatedClearanceInput = {
    srj: { ...fixture.originalSrj, traces: undefined }, routes: fixture.routes,
    bounds: fixture.originalSrj.bounds, dirtyRouteIndices: [0, 1, 2, 3],
    isLocked: (): boolean => false, traceClearance: 0.1, viaClearance: 0.1,
    allowLayerChanges: true, maxPathSearchCalls: 24, maxPathSearchNodes: 240000,
    maxPathSearchNodesPerCall: 10000, pathHeuristicWeight: 1.5,
  }
  const worklist = new ClearanceSearchTaskWorklist()
  const first = new NegotiateTraceClearanceSolver({ ...input, searchTaskWorklist: worklist })
  const native = new NativeNegotiation(input)
  first.solve()
  native.solve()
  expect(first.failed, first.error ?? "").toBe(false)
  expect(first.getOutput()).toEqual(native.getOutput())
  const initial = worklist.getStats()
  const repeated = new NegotiateTraceClearanceSolver({ ...input, searchTaskWorklist: worklist })
  repeated.solve()
  expect(repeated.getOutput()).toEqual(native.getOutput())
  expect(repeated.stats.pathSearchCalls).toBe(native.stats.pathSearchCalls)
  expect(repeated.stats.pathSearchNodes).toBe(native.stats.pathSearchNodes)
  const final = worklist.getStats()
  expect(final.searchTaskAvoidedInvocationCount).toBeGreaterThan(initial.searchTaskAvoidedInvocationCount)
  expect(final.searchTaskNativeInvocationCount).toBe(initial.searchTaskNativeInvocationCount)
  expect(final.searchTaskRetainedCount).toBeLessThanOrEqual(worklist.maxTasks)
  expect(final.searchTaskRetainedCharacters).toBeLessThanOrEqual(worklist.maxRetainedCharacters)
})
