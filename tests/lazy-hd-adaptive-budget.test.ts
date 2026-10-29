import { expect, test } from "bun:test"
import { isUnmaterializedLazyHdCandidate } from "lib/solvers/HyperHighDensitySolver/lazyHdGridCandidates"
import { makeLazyHdPortfolio, makeLazyHdSyntheticNode } from "./fixtures/lazyHdSynthetic"

test("adaptive seed admission and changing a deferred candidate limit preserve native work accounting", () => {
  const node = makeLazyHdSyntheticNode(8)
  const native = makeLazyHdPortfolio(node, false)
  const lazy = makeLazyHdPortfolio(node, true)
  native.initializeSolvers()
  lazy.initializeSolvers()
  ;(native as any).expandAdaptiveSearch()
  ;(lazy as any).expandAdaptiveSearch()
  expect(lazy.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect(lazy.stats).toEqual(native.stats)
  expect(lazy.supervisedSolvers!.map(({ solver, f, g, h, hyperParameters }) => [solver.MAX_ITERATIONS, solver.iterations, f, g, h, hyperParameters])).toEqual(native.supervisedSolvers!.map(({ solver, f, g, h, hyperParameters }) => [solver.MAX_ITERATIONS, solver.iterations, f, g, h, hyperParameters]))
  const nativeSeeds = native.supervisedSolvers!.filter(({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01)
  const lazySeeds = lazy.supervisedSolvers!.filter(({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01)
  expect(lazySeeds).toHaveLength(6)
  for (let index = 0; index < nativeSeeds.length; index++) {
    const a = nativeSeeds[index]!.solver
    const b = lazySeeds[index]!.solver
    expect(isUnmaterializedLazyHdCandidate(b)).toBeTrue()
    a.MAX_ITERATIONS = 17
    b.MAX_ITERATIONS = 17
    while (!a.solved && !a.failed) { a.step(); b.step() }
    expect(b.MAX_ITERATIONS).toBe(a.MAX_ITERATIONS)
    expect(b.iterations).toBe(a.iterations)
    expect(b.failed).toBe(a.failed)
    expect(b.solved).toBe(a.solved)
    expect(b.error).toBe(a.error)
    expect(lazy.computeG(b as any)).toBe(native.computeG(a as any))
  }
  ;(native as any).refreshDynamicIterationLimit()
  ;(lazy as any).refreshDynamicIterationLimit()
  expect(lazy.MAX_ITERATIONS).toBe(native.MAX_ITERATIONS)
  expect((lazy as any).dynamicExpansionWorkBudget).toBe((native as any).dynamicExpansionWorkBudget)
  expect((lazy as any).totalCandidateWork).toBe((native as any).totalCandidateWork)
  expect((lazy as any).lazyHdCounters.lazyHdMaterializedA01Candidates).toBe(6)
})
