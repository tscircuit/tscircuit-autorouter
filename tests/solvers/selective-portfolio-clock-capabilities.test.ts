import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { selectiveTestNode } from "./selectivePortfolioTestUtils"

type ThreadCpuProcess = { threadCpuUsage?: () => { user: number; system: number } }

test("clock capability selection is explicit and unsupported requested thread timing throws", (): void => {
  const runtimeProcess = process as unknown as ThreadCpuProcess
  const originalThreadCpu = runtimeProcess.threadCpuUsage
  const params = { nodeWithPortPoints: selectiveTestNode, selectivePortfolio: true }
  try {
    expect(new PortfolioSingleIntraNodeSolver(params).selectiveClockSource).toBe("threadCpu")
    runtimeProcess.threadCpuUsage = undefined
    const compatible = new PortfolioSingleIntraNodeSolver(params)
    compatible.initializeSolvers()
    expect(compatible.selectiveClockSource).toBe("cpu")
    expect(compatible.stats.selectiveClockScope).toBe("process")
    expect(compatible.stats.selectiveThreadCpuSupported).toBe(false)
    expect(() => new PortfolioSingleIntraNodeSolver({ ...params, selectivePortfolioTiming: "threadCpu" })).toThrow("process.threadCpuUsage()")
    expect(new PortfolioSingleIntraNodeSolver({ ...params, selectivePortfolioTiming: "elapsed" }).selectiveClockSource).toBe("elapsed")
  } finally {
    runtimeProcess.threadCpuUsage = originalThreadCpu
  }
})
