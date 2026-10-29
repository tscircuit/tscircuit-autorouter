import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { getLazyHdGridPlan, initializeLazyHdCandidateCounters, LazyHighDensitySolverA01, LazyHighDensitySolverA03 } from "lib/solvers/HyperHighDensitySolver/lazyHdGridCandidates"
import { makeLazyHdSyntheticNode, expectNativeHdStateEqual } from "./fixtures/lazyHdSynthetic"

test("the2M native budget witness preserves adaptive grid shapes and every initial native field", () => {
  for (let seed = 0; seed < 36; seed++) {
    const node = makeLazyHdSyntheticNode(seed)
    node.width = [0.1, 0.2, 0.8, 1.1, 1.6, 4.8][seed % 6]!
    node.height = [0.1, 0.3, 0.9, 1.3, 1.7, 5.1][seed % 6]!
    node.availableZ = [0, 1, 3, 5].slice(0, 1 + seed % 4)
    const cap = [150_000, 1_200_000, 2_000_000][seed % 3]!
    for (const kind of ["A01", "A03"] as const) {
      const common = { nodeWithPortPoints: node, viaDiameter: 0.25, traceThickness: 0.1, traceMargin: 0.1, viaMinDistFromBorder: 0.125, effort: 1, hyperParameters: { shuffleSeed: seed } }
      const counters = initializeLazyHdCandidateCounters({})
      const plan = getLazyHdGridPlan(node, kind, () => cap)!
      expect(plan).not.toBeNull()
      const native = kind === "A01" ? new HighDensitySolverA01({ ...common, cellSizeMm: 0.1 }) : new HighDensitySolverA03({ ...common, highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, highResolutionCellThickness: 8 })
      const lazy = kind === "A01" ? new LazyHighDensitySolverA01({ ...common, cellSizeMm: 0.1 }, plan, counters) : new LazyHighDensitySolverA03({ ...common, highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, highResolutionCellThickness: 8 }, plan, counters)
      native.setup()
      expect(native.MAX_ITERATIONS).toBeGreaterThanOrEqual(2_000_000)
      native.MAX_ITERATIONS = Math.min(native.MAX_ITERATIONS, cap)
      expect(lazy.gridMaterialized).toBeFalse()
      expect(lazy.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
      lazy.setup()
      expect(lazy.gridStats.cells).toBe(plan.cells)
      expect(lazy.gridStats.states).toBe(plan.states)
      expect(counters.lazyHdMaterializedCandidates).toBe(1)
      expect(counters.lazyHdMaterializedGridCells).toBe(plan.cells)
      expect(counters.lazyHdMaterializedGridStates).toBe(plan.states)
      expectNativeHdStateEqual(native, lazy)
    }
  }
})
