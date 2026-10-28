import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { createLazyPortfolioNode, policySnapshot, RareOrderingPortfolio } from "./lazyPortfolioTestUtils"

test("lazy setup preserves every eager scheduling decision and the rare last A01 ordering winner", (): void => {
  const params = { nodeWithPortPoints: createLazyPortfolioNode(), traceWidth: 0.1,
    viaDiameter: 0.3, enableNegotiatedSearch: true, cacheProvider: null }
  const eager = new RareOrderingPortfolio({ ...params, portfolioMode: "eager" })
  const lazy = new RareOrderingPortfolio({ ...params, portfolioMode: "lazy" })
  eager.initializeSolvers()
  lazy.initializeSolvers()
  expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
  let observedExpansion = false
  for (let dispatch = 0; dispatch < 100; dispatch++) {
    eager.step()
    lazy.step()
    expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
    if (eager.adaptiveSearchExpanded) observedExpansion = true
    if (eager.solved || eager.failed) break
  }
  expect(observedExpansion).toBe(true)
  expect(eager.solved).toBe(true)
  expect(lazy.solved).toBe(true)
  expect(lazy.failed).toBe(false)
  expect(lazy.winningSolver instanceof HighDensitySolverA01).toBe(true)
  expect((lazy.winningSolver as unknown as HighDensitySolverA01).hyperParameters.shuffleSeed).toBe(5)
  expect(lazy.supervisedSolvers!.filter(({ solver }) => solver instanceof HighDensitySolverA01)).toHaveLength(6)
  expect(JSON.stringify(lazy.solvedRoutes)).toBe(JSON.stringify(eager.solvedRoutes))
})
