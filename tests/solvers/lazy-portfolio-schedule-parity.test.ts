import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { createLazyPortfolioNode, policySnapshot, RareOrderingPortfolio } from "./lazyPortfolioTestUtils"

test("lazy setup preserves every legacy scheduling decision and the rare last A01 ordering winner", (): void => {
  for (const traceWidth of [0.15, 0.2]) {
    const params = { nodeWithPortPoints: createLazyPortfolioNode(), traceWidth,
      viaDiameter: 0.3, enableNegotiatedSearch: true, cacheProvider: null }
    const legacy = new RareOrderingPortfolio({ ...params, portfolioMode: "legacy" })
    const eager = new RareOrderingPortfolio({ ...params, portfolioMode: "eager" })
    const lazy = new RareOrderingPortfolio({ ...params, portfolioMode: "lazy" })
    for (const portfolio of [legacy, eager, lazy]) portfolio.initializeSolvers()
    expect(policySnapshot(eager)).toEqual(policySnapshot(legacy))
    expect(policySnapshot(lazy)).toEqual(policySnapshot(legacy))
    let observedExpansion = false
    for (let dispatch = 0; dispatch < 100; dispatch++) {
      for (const portfolio of [legacy, eager, lazy]) portfolio.step()
      expect(policySnapshot(eager)).toEqual(policySnapshot(legacy))
      expect(policySnapshot(lazy)).toEqual(policySnapshot(legacy))
      if (legacy.adaptiveSearchExpanded) observedExpansion = true
      if (legacy.solved || legacy.failed) break
    }
    expect(observedExpansion).toBe(true)
    expect(lazy.stats.lazyGridSetupDeferredCount).toBeGreaterThan(0)
    expect(lazy.stats.lazyGridSetupMaterializedCount).toBeGreaterThan(0)
    for (const portfolio of [legacy, eager, lazy]) {
      expect(portfolio.solved).toBe(true)
      expect(portfolio.failed).toBe(false)
      expect(portfolio.winningSolver instanceof HighDensitySolverA01).toBe(true)
      expect((portfolio.winningSolver as unknown as HighDensitySolverA01).hyperParameters.shuffleSeed).toBe(5)
      expect(portfolio.supervisedSolvers!.filter(({ solver }) => solver instanceof HighDensitySolverA01)).toHaveLength(6)
      expect(JSON.stringify(portfolio.solvedRoutes)).toBe(JSON.stringify(legacy.solvedRoutes))
    }
  }
})
