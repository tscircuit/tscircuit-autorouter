import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { getLazyHdGridPlan, initializeLazyHdCandidateCounters, LazyHighDensitySolverA01, LazyHighDensitySolverA03 } from "lib/solvers/HyperHighDensitySolver/lazyHdGridCandidates"
import { makeLazyHdSyntheticNode, expectNativeHdStateEqual } from "./fixtures/lazyHdSynthetic"

test("explicit native public inspection materializes once without spending any search work", () => {
  for (const kind of ["A01", "A03"] as const) {
    for (const view of ["unsolvedConnections", "solvedConnectionsMap", "gridStats", "output"] as const) {
      const node = makeLazyHdSyntheticNode(5)
      const common = { nodeWithPortPoints: node, viaDiameter: 0.25, traceThickness: 0.1, traceMargin: 0.1, viaMinDistFromBorder: 0.125, effort: 1 }
      const plan = getLazyHdGridPlan(node, kind, () => 150_000)!
      const counters = initializeLazyHdCandidateCounters({})
      const native = kind === "A01" ? new HighDensitySolverA01({ ...common, cellSizeMm: 0.1 }) : new HighDensitySolverA03({ ...common, highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, highResolutionCellThickness: 8 })
      const lazy = kind === "A01" ? new LazyHighDensitySolverA01({ ...common, cellSizeMm: 0.1 }, plan, counters) : new LazyHighDensitySolverA03({ ...common, highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, highResolutionCellThickness: 8 }, plan, counters)
      native.setup(); native.MAX_ITERATIONS = 150_000
      expect(lazy.gridMaterialized).toBeFalse()
      if (view === "output") expect(lazy.getOutput()).toEqual(native.getOutput())
      else expect(lazy[view]).toEqual(native[view])
      expect(lazy.gridMaterialized).toBeTrue()
      lazy.setup()
      expect(counters.lazyHdMaterializedCandidates).toBe(1)
      expect(lazy.iterations).toBe(0)
      expectNativeHdStateEqual(native, lazy)
    }
  }
})
