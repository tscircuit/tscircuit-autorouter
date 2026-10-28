import { expect, spyOn, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { policySnapshot } from "./lazyPortfolioTestUtils"

type ThreadCpuProcess = typeof process & { threadCpuUsage: () => { user: number; system: number } }

test("deterministic eager and lazy routing do not read elapsed, process or thread CPU clocks", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "no-clock-decisions",
    center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -2, y: -1, z: 0 },
      { connectionName: "A", x: 2, y: 1, z: 0 },
      { connectionName: "B", x: -2, y: 1, z: 1 },
      { connectionName: "B", x: 2, y: -1, z: 1 },
    ] }
  const failOnClock = (): never => {
    throw new Error("Deterministic routing read a policy clock")
  }
  const wall = spyOn(performance, "now").mockImplementation(failOnClock)
  const cpu = spyOn(process, "cpuUsage").mockImplementation(failOnClock)
  const thread = spyOn(process as ThreadCpuProcess, "threadCpuUsage").mockImplementation(failOnClock)
  try {
    const params = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3,
      enableNegotiatedSearch: true, cacheProvider: null, captureSearchDebug: false }
    const eager = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "eager" })
    const lazy = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "lazy" })
    eager.solve()
    lazy.solve()
    expect(eager.solved).toBe(true)
    expect(lazy.solved).toBe(true)
    expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
    expect(lazy.solvedRoutes).toEqual(eager.solvedRoutes)
  } finally {
    wall.mockRestore()
    cpu.mockRestore()
    thread.mockRestore()
  }
})
