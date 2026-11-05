import { expect, spyOn, test } from "bun:test"
import { SimulatedSelectivePortfolio } from "./selectivePortfolioTestUtils"

test("an immediate geometric winner never constructs grid or ordering candidates", (): void => {
  const clock = { now: 0 }
  const mockNow = spyOn(performance, "now").mockImplementation(() => clock.now)
  try {
    const portfolio = new SimulatedSelectivePortfolio({ clock, millisecondsPerStep: 1, fastWinner: true })
    portfolio.initializeSolvers()
    expect(portfolio.constructed).toHaveLength(0)
    portfolio.solve()
    expect(portfolio.solved).toBe(true)
    expect(portfolio.constructed).toEqual([{ THROUGH_OBSTACLE: true }])
    expect(portfolio.supervisedSolvers).toHaveLength(1)
    expect(portfolio.solvedRoutes).toHaveLength(1)
    expect(portfolio.stats.selectiveAttemptStatus).toBe("solved")
  } finally {
    mockNow.mockRestore()
  }
})
