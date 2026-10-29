import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { getLazyHdGridPlan, initializeLazyHdCandidateCounters, LazyHighDensitySolverA01, LazyHighDensitySolverA03 } from "lib/solvers/HyperHighDensitySolver/lazyHdGridCandidates"
import { makeLazyHdSyntheticNode, expectNativeHdStateEqual } from "./fixtures/lazyHdSynthetic"

test("lazy setup preserves every native search-state field, iteration, route and termination across seeded kernels", () => {
  for (let seed = 0; seed < 24; seed++) {
    for (const kind of ["A01", "A03"] as const) {
      const node = makeLazyHdSyntheticNode(seed)
      const common = { nodeWithPortPoints: node, viaDiameter: 0.25, traceThickness: 0.1, traceMargin: 0.1, viaMinDistFromBorder: 0.125, effort: 1, hyperParameters: { shuffleSeed: seed } }
      const plan = getLazyHdGridPlan(node, kind, () => 150_000)!
      const counters = initializeLazyHdCandidateCounters({})
      const native = kind === "A01" ? new HighDensitySolverA01({ ...common, cellSizeMm: 0.1 }) : new HighDensitySolverA03({ ...common, highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, highResolutionCellThickness: 8 })
      const lazy = kind === "A01" ? new LazyHighDensitySolverA01({ ...common, cellSizeMm: 0.1 }, plan, counters) : new LazyHighDensitySolverA03({ ...common, highResolutionCellSize: 0.1, lowResolutionCellSize: 0.4, highResolutionCellThickness: 8 }, plan, counters)
      native.setup()
      native.MAX_ITERATIONS = Math.min(native.MAX_ITERATIONS, plan.iterationLimit)
      for (let step = 0; step < 1500 && !native.solved && !native.failed; step++) {
        native.step()
        lazy.step()
        if (step % 127 === 0 || native.solved || native.failed) expectNativeHdStateEqual(native, lazy)
      }
      expectNativeHdStateEqual(native, lazy)
      expect(lazy.solved).toBe(native.solved)
      expect(lazy.failed).toBe(native.failed)
      expect(counters.lazyHdMaterializedCandidates).toBe(1)
    }
  }
})
