import { expect, test } from "bun:test"
import { HighDensitySolverA01, HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { GridOnlyPortfolio, createLazyPortfolioNode } from "./lazyPortfolioTestUtils"

test("explicit inspection materializes one deferred grid and preserves the eager public state", (): void => {
  for (const inspected of ["getOutput", "solvedConnectionsMap", "unsolvedConnections", "gridStats", "activeConnection", "openSet"] as const) {
    const params = { nodeWithPortPoints: createLazyPortfolioNode(), traceWidth: 0.1,
      viaDiameter: 0.3, enableNegotiatedSearch: true, cacheProvider: null }
    const eager = new GridOnlyPortfolio({ ...params, portfolioMode: "eager" })
    const lazy = new GridOnlyPortfolio({ ...params, portfolioMode: "lazy" })
    eager.initializeSolvers()
    lazy.initializeSolvers()
    const before = eager.supervisedSolvers!.find(({ solver }) => solver instanceof HighDensitySolverA03)!.solver as unknown as HighDensitySolverA03
    const after = lazy.supervisedSolvers!.find(({ solver }) => solver instanceof HighDensitySolverA03)!.solver as unknown as HighDensitySolverA03
    const unused = lazy.supervisedSolvers!.find(({ solver }) => solver instanceof HighDensitySolverA01)!.solver as unknown as HighDensitySolverA01
    expect(after._setupDone).toBe(false)
    const actual = inspected === "getOutput" ? after.getOutput() : after[inspected]
    const expected = inspected === "getOutput" ? before.getOutput() : before[inspected]
    expect(actual).toEqual(expected)
    expect(after._setupDone).toBe(true)
    expect(after.MAX_ITERATIONS).toBe(before.MAX_ITERATIONS)
    expect(after.iterations).toBe(0)
    expect(unused._setupDone).toBe(false)
    expect(lazy.stats.lazyGridSetupMaterializedCount).toBe(1)
    expect(Object.hasOwn(after, "gridStats")).toBe(false)
  }
})
