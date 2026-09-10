import { expect, test } from "bun:test"
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import nodeJson from "../fixtures/srj18-sample002-large-node.json"

const node: NodeWithPortPoints = nodeJson

test("enabling A13 preserves a successful existing search and its routes", () => {
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
