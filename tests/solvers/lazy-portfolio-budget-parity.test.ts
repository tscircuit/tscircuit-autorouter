import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { createLazyPortfolioNode, GridOnlyPortfolio, policySnapshot } from "./lazyPortfolioTestUtils"

test("lazy candidates advertise exact eager caps and preserve them when setup materializes", (): void => {
  for (const effort of [0.25, 1, 2]) {
    const params = { nodeWithPortPoints: createLazyPortfolioNode(), traceWidth: 0.1,
      viaDiameter: 0.3, effort, enableNegotiatedSearch: true, cacheProvider: null }
    const eager = new GridOnlyPortfolio({ ...params, portfolioMode: "eager" })
    const lazy = new GridOnlyPortfolio({ ...params, portfolioMode: "lazy" })
    eager.initializeSolvers()
    lazy.initializeSolvers()
    const a01 = (portfolio: GridOnlyPortfolio): HighDensitySolverA01 =>
      portfolio.supervisedSolvers!.find(({ solver }) => solver instanceof HighDensitySolverA01)!.solver as unknown as HighDensitySolverA01
    const a03 = (portfolio: GridOnlyPortfolio): HighDensitySolverA03 =>
      portfolio.supervisedSolvers!.find(({ solver }) => solver instanceof HighDensitySolverA03)!.solver as unknown as HighDensitySolverA03
    expect(a01(eager)._setupDone).toBe(true)
    expect(a03(eager)._setupDone).toBe(true)
    expect(a01(lazy)._setupDone).toBe(false)
    expect(a03(lazy)._setupDone).toBe(false)
    expect(a01(lazy).MAX_ITERATIONS).toBe(640_000)
    expect(a03(lazy).MAX_ITERATIONS).toBe(a03(eager).MAX_ITERATIONS)
    expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
    for (let dispatch = 0; dispatch < 2; dispatch++) {
      eager.step()
      lazy.step()
      expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
    }
    expect(a01(lazy)._setupDone).toBe(true)
    expect(a03(lazy)._setupDone).toBe(true)
    expect(a01(lazy).MAX_ITERATIONS).toBe(640_000)
    expect(a03(lazy).MAX_ITERATIONS).toBe(a03(eager).MAX_ITERATIONS)
  }
  const larger = new GridOnlyPortfolio({ nodeWithPortPoints: createLazyPortfolioNode(16),
    traceWidth: 0.1, viaDiameter: 0.3, portfolioMode: "lazy" })
  larger.initializeSolvers()
  for (const { solver } of larger.supervisedSolvers!) {
    if (solver instanceof HighDensitySolverA01 || solver instanceof HighDensitySolverA03) {
      expect(solver._setupDone).toBe(true)
      expect(solver.MAX_ITERATIONS).toBe(2_000_000)
    }
  }
})
