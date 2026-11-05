import { expect, spyOn, test } from "bun:test"
import { SimulatedSelectivePortfolio } from "./selectivePortfolioTestUtils"

test("later faster search cannot retroactively shrink an allocated physical attempt", (): void => {
  const clock = { now: 0 }
  const workload = { clock, millisecondsPerStep: 0.001, iterationLimit: 100_000 }
  const mockNow = spyOn(performance, "now").mockImplementation(() => clock.now)
  try {
    const portfolio = new SimulatedSelectivePortfolio(workload)
    while (!Number.isFinite(portfolio.stats.selectiveAttemptBudgetMs)) portfolio.step()
    const allocatedBudget = portfolio.stats.selectiveAttemptBudgetMs
    workload.millisecondsPerStep /= 10
    portfolio.solve()
    expect(portfolio.stats.selectiveAttemptBudgetMs).toBe(allocatedBudget)
    expect(portfolio.stats.selectiveCalibrationRates).toHaveLength(3)
    expect(portfolio.stats.selectiveCalibrationRates.every((rate: number) => Math.abs(rate - 0.001) < 1e-8)).toBe(true)
    expect(portfolio.error).toContain("UNKNOWN")
  } finally {
    mockNow.mockRestore()
  }
})
