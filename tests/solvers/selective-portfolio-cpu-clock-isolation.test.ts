import { expect, spyOn, test } from "bun:test"
import { SimulatedSelectivePortfolio } from "./selectivePortfolioTestUtils"

test("CPU-accounted racing preserves its schedule across wall-clock descheduling", (): void => {
  const clock = { now: 0 }
  let wallCalls = 0
  let wallDelay = 0
  const mockCpu = spyOn(process, "cpuUsage").mockImplementation(() => ({ user: Math.round(clock.now * 1000), system: 0 }))
  const mockNow = spyOn(performance, "now").mockImplementation(() => clock.now + ++wallCalls * wallDelay)
  try {
    const first = new SimulatedSelectivePortfolio({ clock, millisecondsPerStep: 0.001, iterationLimit: 10_000, clockSource: "cpu" })
    first.solve()
    clock.now = 0
    wallDelay = 1000
    const delayed = new SimulatedSelectivePortfolio({ clock, millisecondsPerStep: 0.001, iterationLimit: 10_000, clockSource: "cpu" })
    delayed.solve()
    expect(first.stats.selectiveClockSource).toBe("cpu")
    expect(delayed.stats.selectiveCandidates).toEqual(first.stats.selectiveCandidates)
    expect(delayed.stats.selectiveAttemptBudgetMs).toBe(first.stats.selectiveAttemptBudgetMs)
    expect(delayed.stats.selectiveCpuMs).toBe(first.stats.selectiveCpuMs)
    expect(delayed.stats.selectiveWallElapsedMs).toBeGreaterThan(first.stats.selectiveWallElapsedMs + 900)
  } finally {
    mockCpu.mockRestore()
    mockNow.mockRestore()
  }
})
