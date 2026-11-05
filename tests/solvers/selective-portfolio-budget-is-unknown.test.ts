import { expect, spyOn, test } from "bun:test"
import { SimulatedSelectivePortfolio } from "./selectivePortfolioTestUtils"

test("calibrated attempt exhaustion preserves paused candidates and reports UNKNOWN", (): void => {
  const clock = { now: 0 }
  const mockNow = spyOn(performance, "now").mockImplementation(() => clock.now)
  try {
    const portfolio = new SimulatedSelectivePortfolio({ clock, millisecondsPerStep: 0.001, iterationLimit: 100_000 })
    portfolio.solve()
    expect(portfolio.failed).toBe(true)
    expect(portfolio.solved).toBe(false)
    expect(portfolio.error).toContain("UNKNOWN")
    expect(portfolio.stats.selectiveAttemptStatus).toBe("unknown")
    expect(Number.isFinite(portfolio.stats.selectiveAttemptBudgetMs)).toBe(true)
    expect(portfolio.stats.selectiveElapsedMs).toBeGreaterThanOrEqual(portfolio.stats.selectiveAttemptBudgetMs)
    expect(portfolio.stats.selectiveCandidates).toHaveLength(portfolio.stats.selectiveCandidateCount)
    expect(portfolio.stats.selectiveCandidates.every((candidate: { quanta: number }) => candidate.quanta > 0)).toBe(true)
    expect(portfolio.supervisedSolvers!.every(({ solver }) => !solver.failed && solver.iterations < solver.MAX_ITERATIONS)).toBe(true)
  } finally {
    mockNow.mockRestore()
  }
})
