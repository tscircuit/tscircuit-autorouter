import { expect, test } from "bun:test"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
const node: NodeWithPortPoints = {
  capacityMeshNodeId: "immediate-legacy-route",
  width: 4,
  height: 4,
  center: { x: 0, y: 0 },
  availableZ: [0, 1],
  portPoints: [
    { connectionName: "a", x: -2, y: 0, z: 0 },
    { connectionName: "a", x: 2, y: 0, z: 0 },
  ],
}

test("an immediately solved legacy route bypasses A13 search", () => {
  const params = {
    nodeWithPortPoints: node,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
    effort: 1,
  }
  const original = new PortfolioSingleIntraNodeSolver(structuredClone(params))
  const enabled = new PortfolioSingleIntraNodeSolver({
    ...structuredClone(params),
    enableNegotiatedSearch: true,
  })
  getGlobalInMemoryCache().clearCache()
  original.solve()
  getGlobalInMemoryCache().clearCache()
  enabled.solve()
  expect(original.solved).toBe(true)
  expect(enabled.solved).toBe(true)
  expect(enabled.negotiatedSearchStarted).toBe(false)
  expect(enabled.iterations).toBe(original.iterations)
  expect(enabled.solvedRoutes).toEqual(original.solvedRoutes)
})
