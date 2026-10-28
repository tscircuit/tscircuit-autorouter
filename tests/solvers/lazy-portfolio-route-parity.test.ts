import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { policySnapshot } from "./lazyPortfolioTestUtils"

test("real multilayer routes retain exact legacy geometry, winner and work in eager and lazy modes", (): void => {
  for (const traceWidth of [0.1, 0.15, 0.2]) {
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
    const legacy = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode: "legacy" })
    legacy.solve()
    expect(legacy.solved).toBe(true)
    for (const portfolioMode of ["eager", "lazy"] as const) {
      const actual = new PortfolioSingleIntraNodeSolver({ ...params, portfolioMode })
      actual.solve()
      expect(actual.solved).toBe(true)
      expect(actual.failed).toBe(false)
      expect(policySnapshot(actual)).toEqual(policySnapshot(legacy))
      expect(JSON.stringify(actual.solvedRoutes)).toBe(JSON.stringify(legacy.solvedRoutes))
      expect(areNodePortPointPairsConnectedByRoutes(actual.solvedRoutes, node)).toBe(true)
    }
  }
})
