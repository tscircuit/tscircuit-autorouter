import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { NativeCoalescedIntraNodeSolver } from "lib/solvers/HighDensitySolver/NativeCoalescedIntraNodeSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { nativeCoalescingParams } from "./nativeCoalescingTestUtils"

test("native-only control keeps first original0/100 seeds, summed family caps and unrelated candidate families", () => {
  const params = nativeCoalescingParams(), portfolio = new PortfolioSingleIntraNodeSolver(params)
  const combinations = portfolio.getCombinationDefs().flatMap((names) => portfolio.getHyperParameterCombinations(
    portfolio.getHyperParameterDefs().filter((d) => names.includes(d.name))))
  const families = combinations.filter((hp) => hp.NATIVE_COALESCED_FAMILY_SIZE)
  expect(families).toHaveLength(8)
  expect(families.reduce((sum, hp) => sum + hp.NATIVE_COALESCED_FAMILY_SIZE, 0)).toBe(62)
  for (const hp of families) {
    expect(hp.SHUFFLE_SEED).toBe(hp.NATIVE_COALESCED_FAMILY_SIZE === 20 ? 100 : 0)
    const solver = portfolio.generateSolver(hp)
    expect(solver).toBeInstanceOf(NativeCoalescedIntraNodeSolver)
    expect(solver.hyperParameters.SHUFFLE_SEED).toBe(hp.SHUFFLE_SEED)
    expect(Reflect.get(solver.hyperParameters, "NATIVE_COALESCED_FAMILY_SIZE")).toBe(hp.NATIVE_COALESCED_FAMILY_SIZE)
  }
  const noVias = portfolio.getHyperParameterDefs().find((def) => def.name === "noVias")!.possibleValues[0]
  expect(noVias).toEqual({ CELL_SIZE_FACTOR: 2, VIA_PENALTY_FACTOR_2: 10 })
  expect(portfolio.generateSolver(noVias)).toBeInstanceOf(CachedIntraNodeRouteSolver)
  expect(portfolio.generateSolver(noVias)).not.toBeInstanceOf(NativeCoalescedIntraNodeSolver)
  expect(portfolio.getHyperParameterDefs().find((def) => def.name === "highDensityA13")?.possibleValues).toEqual([{ HIGH_DENSITY_A13: true, SHUFFLE_SEED: 0 }])
})
