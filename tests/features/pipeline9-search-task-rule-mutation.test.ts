import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver as NativeNegotiation, type NegotiatedClearanceInput } from "@tscircuit/repair04"
import { NegotiateTraceClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearance/NegotiateTraceClearanceSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("active search contracts reject rule and separate-bounds mutations and isolate restored transient changes", (): void => {
  for (const mutation of ["rule", "bounds", "restored"] as const) {
    const fixture = createBoundedRegionalRepairFixture()
    const input: NegotiatedClearanceInput = {
      srj: { ...fixture.originalSrj, traces: undefined }, routes: fixture.routes,
      bounds: { ...fixture.originalSrj.bounds }, dirtyRouteIndices: [0],
      isLocked: (): boolean => false, traceClearance: 0.1, viaClearance: 0.1,
      allowLayerChanges: true, maxPathSearchCalls: 4, maxPathSearchNodes: 20000,
      maxPathSearchNodesPerCall: 10000,
    }
    const solver = new NegotiateTraceClearanceSolver(input)
    if (mutation === "restored") {
      solver.step()
      const originalRoutes = input.routes.splice(0)
      // Batching must also use the owned snapshot, before a child exists.
      solver.step()
      input.routes.push(...originalRoutes)
    }
    while (!solver.activeSubSolver && !solver.solved && !solver.failed) solver.step()
    expect(solver.activeSubSolver).toBeDefined()
    const originalMinX = input.bounds.minX
    if (mutation !== "bounds") input.traceClearance = 0.2
    if (mutation !== "rule") input.bounds.minX = originalMinX + 0.01
    if (mutation === "restored") {
      // The active child's geometry and its cost closure must both use the
      // owned snapshot while the caller's fields temporarily disagree.
      for (let step = 0; step < 3; step++) solver.step()
      expect(solver.activeSubSolver).toBeDefined()
      input.traceClearance = 0.1
      input.bounds.minX = originalMinX
      solver.solve()
      const native = new NativeNegotiation(input)
      native.solve()
      expect(solver.getOutput()).toEqual(native.getOutput())
      expect(solver.stats.pathSearchNodes).toBe(native.stats.pathSearchNodes)
      expect(solver.stats.pathSearchCalls).toBe(native.stats.pathSearchCalls)
      expect(solver.stats.searchTaskSnapshotRoutePoints).toBeGreaterThan(0)
      expect(solver.stats.searchTaskSerializedCodeUnits).toBeGreaterThan(0)
      expect(Number.isSafeInteger(solver.stats.searchTaskNarrowPhaseChecks)).toBe(true)
      expect(solver.stats.searchTaskNarrowPhaseChecks).toBeGreaterThanOrEqual(0)
      expect(solver.stats.searchTaskNarrowPhaseChecks)
        .toBeLessThanOrEqual(solver.stats.searchTaskCopperCandidateChecks)
    } else {
      expect(() => solver.solve()).toThrow("inputs changed during an active dependency task")
      expect(solver.searchTaskWorklist.getStats().searchTaskStoredCount).toBe(0)
      expect(solver.failed).toBe(true)
    }
  }
})
