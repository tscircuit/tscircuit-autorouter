import { expect, spyOn, test } from "bun:test"
import { SimulatedSelectivePortfolio } from "./selectivePortfolioTestUtils"

test("stagnant 95-percent candidates do not starve the last ordering seed", (): void => {
  const clock = { now: 0 }
  const mockNow = spyOn(performance, "now").mockImplementation(() => clock.now)
  try {
    const portfolio = new SimulatedSelectivePortfolio({ clock, millisecondsPerStep: 1, winningSeed: 5, stepsToWin: 300 })
    portfolio.solve()
    expect(portfolio.solved).toBe(true)
    expect(portfolio.failed).toBe(false)
    expect(portfolio.adaptiveSearchExpanded).toBe(true)
    expect(portfolio.constructed.filter((hp) => hp.HIGH_DENSITY_A01).map((hp) => hp.SHUFFLE_SEED)).toEqual([0, 1, 2, 3, 4, 5])
    expect(portfolio.supervisedSolvers!.every(({ solver }) => !solver.failed)).toBe(true)
    expect(portfolio.stats.selectiveCandidates.find((candidate: { solved: boolean }) => candidate.solved).shuffleSeed).toBe(5)
    expect(portfolio.supervisedSolvers!.some(({ solver }) => solver.iterations > 128)).toBe(true)
    expect(portfolio.stats.selectiveCandidates.find((candidate: { solved: boolean }) => candidate.solved).quanta).toBeGreaterThan(1)
    expect(portfolio.iterations).toBeLessThan(100)
  } finally {
    mockNow.mockRestore()
  }
})
