import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { policySnapshot } from "./lazyPortfolioTestUtils"

test("real multilayer routes retain exact eager geometry, winner and work in lazy mode", (): void => {
  for (const traceWidth of [0.1, 0.15]) {
    const node: NodeWithPortPoints = { capacityMeshNodeId: `real-lazy-crossing-${traceWidth}`,
      center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
      portPoints: [
        { connectionName: "A", x: -2, y: -1, z: 0 },
        { connectionName: "A", x: 2, y: 1, z: 0 },
        { connectionName: "B", x: -2, y: 1, z: 1 },
        { connectionName: "B", x: 2, y: -1, z: 1 },
      ] }
    const params = { nodeWithPortPoints: node, traceWidth, viaDiameter: 0.3,
      enableNegotiatedSearch: true, cacheProvider: null, captureSearchDebug: false }
    const eager = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "eager" })
    const lazy = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "lazy" })
    eager.solve()
    lazy.solve()
    expect(eager.solved).toBe(true)
    expect(lazy.solved).toBe(true)
    expect(lazy.failed).toBe(false)
    expect(policySnapshot(lazy)).toEqual(policySnapshot(eager))
    expect(JSON.stringify(lazy.solvedRoutes)).toBe(JSON.stringify(eager.solvedRoutes))
    expect(areNodePortPointPairsConnectedByRoutes(lazy.solvedRoutes, node)).toBe(true)
  }
})
