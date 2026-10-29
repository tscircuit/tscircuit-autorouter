import { expect, test } from "bun:test"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { makeLazyHdPortfolio, makeLazyHdSyntheticNode } from "./fixtures/lazyHdSynthetic"

test("portfolio winner, work, fitness, budgets and route policy remain identical while unused grids stay unallocated", () => {
  let deferredNeverMaterialized = 0
  for (let seed = 0; seed < 18; seed++) {
    const node = makeLazyHdSyntheticNode(seed)
    getGlobalInMemoryCache().clearCache()
    const native = makeLazyHdPortfolio(node, false, seed % 2 === 0)
    native.initializeSolvers()
    getGlobalInMemoryCache().clearCache()
    const lazy = makeLazyHdPortfolio(node, true, seed % 2 === 0)
    lazy.initializeSolvers()
    for (let step = 0; step < 400 && !native.solved && !native.failed; step++) {
      native.step()
      lazy.step()
      expect(lazy.iterations).toBe(native.iterations)
      expect(lazy.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
      expect(lazy.solved).toBe(native.solved)
      expect(lazy.failed).toBe(native.failed)
      expect(lazy.adaptiveSearchExpanded).toBe(native.adaptiveSearchExpanded)
      expect(lazy.negotiatedSearchStarted).toBe(native.negotiatedSearchStarted)
      expect(lazy.activeSubSolver?.getSolverName()).toBe(native.activeSubSolver?.getSolverName())
      expect(lazy.solvedRoutes).toEqual(native.solvedRoutes)
      expect(lazy.supervisedSolvers!.map(({ solver, f, g, h, hyperParameters }) => [solver.getSolverName(), solver.MAX_ITERATIONS, solver.iterations, solver.progress, solver.solved, solver.failed, f, g, h, hyperParameters])).toEqual(native.supervisedSolvers!.map(({ solver, f, g, h, hyperParameters }) => [solver.getSolverName(), solver.MAX_ITERATIONS, solver.iterations, solver.progress, solver.solved, solver.failed, f, g, h, hyperParameters]))
    }
    expect(lazy.winningSolver?.getSolverName()).toBe(native.winningSolver?.getSolverName())
    const counters = (lazy as any).lazyHdCounters
    deferredNeverMaterialized += counters.lazyHdDeferredCandidates - counters.lazyHdMaterializedCandidates
  }
  expect(deferredNeverMaterialized).toBeGreaterThan(0)
})
