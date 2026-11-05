import { expect, spyOn, test } from "bun:test"
import { SimulatedSelectivePortfolio } from "./selectivePortfolioTestUtils"

type ThreadCpuProcess = typeof process & { threadCpuUsage: () => { user: number; system: number } }

test("thread-accounted candidates ignore CPU consumed by unrelated worker threads", (): void => {
  const runtimeProcess = process as ThreadCpuProcess
  const clock = { now: 0 }
  let unrelatedCpuMicros = 0
  let incrementPerProcessRead = 0
  const mockThreadCpu = spyOn(runtimeProcess, "threadCpuUsage").mockImplementation(() => ({ user: Math.round(clock.now * 1000), system: 0 }))
  const mockProcessCpu = spyOn(process, "cpuUsage").mockImplementation(() => {
    unrelatedCpuMicros += incrementPerProcessRead
    return { user: Math.round(clock.now * 1000) + unrelatedCpuMicros, system: 0 }
  })
  try {
    const first = new SimulatedSelectivePortfolio({ clock, millisecondsPerStep: 0.001, iterationLimit: 10_000, clockSource: "threadCpu" })
    first.solve()
    clock.now = 0
    incrementPerProcessRead = 1_000_000
    const concurrent = new SimulatedSelectivePortfolio({ clock, millisecondsPerStep: 0.001, iterationLimit: 10_000, clockSource: "threadCpu" })
    concurrent.solve()
    expect(concurrent.stats.selectiveClockSource).toBe("threadCpu")
    expect(concurrent.stats.selectiveClockScope).toBe("thread")
    expect(concurrent.stats.selectiveThreadCpuSupported).toBe(true)
    expect(concurrent.stats.selectiveCandidates).toEqual(first.stats.selectiveCandidates)
    expect(concurrent.stats.selectiveAttemptBudgetMs).toBe(first.stats.selectiveAttemptBudgetMs)
    expect(concurrent.stats.selectiveThreadCpuMs).toBe(first.stats.selectiveThreadCpuMs)
    expect(concurrent.stats.selectiveCpuMs).toBeGreaterThan(first.stats.selectiveCpuMs + 900)
  } finally {
    mockThreadCpu.mockRestore()
    mockProcessCpu.mockRestore()
  }
})
