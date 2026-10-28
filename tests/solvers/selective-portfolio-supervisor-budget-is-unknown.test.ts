import { expect, spyOn, test } from "bun:test"
import { SimulatedSelectivePortfolio } from "./selectivePortfolioTestUtils"

test("the hard supervisor dispatch limit records UNKNOWN without failing paused candidates", (): void => {
  const clock = { now: 0 }
  const mockNow = spyOn(performance, "now").mockImplementation(() => clock.now)
  try {
    const portfolio = new SimulatedSelectivePortfolio({ clock, millisecondsPerStep: 0.001 })
    portfolio.MAX_ITERATIONS = 1
    portfolio.solve()
    expect(portfolio.failed).toBe(true)
    expect(portfolio.solved).toBe(false)
    expect(portfolio.stats.selectiveAttemptStatus).toBe("unknown")
    expect(portfolio.stats.selectiveUnknownReason).toBe("supervisor iteration allocation")
    expect(portfolio.MAX_ITERATIONS).toBe(1)
    expect(portfolio.supervisedSolvers!.every(({ solver }) => !solver.failed)).toBe(true)
    expect(portfolio.stats.selectiveCandidates).toHaveLength(1)
  } finally {
    mockNow.mockRestore()
  }
})
