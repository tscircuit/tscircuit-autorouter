import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import type { PortfolioMode } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("portfolio cache entries cannot cross legacy, eager, lazy or research policy boundaries", (): void => {
  const cacheProvider = new InMemoryCache()
  const node: NodeWithPortPoints = { capacityMeshNodeId: "mode-cache-boundary",
    center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -1, y: 0, z: 0 },
      { connectionName: "A", x: 1, y: 0, z: 1 },
    ] }
  const params = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3, cacheProvider }
  const keys: string[] = []
  for (const portfolioMode of ["legacy", "eager", "lazy", "research-race"] as const) {
    const first = new CachedPortfolioSingleIntraNodeSolver({ ...params, portfolioMode })
    first.solve()
    expect(first.solved).toBe(true)
    expect(first.cacheHit).toBe(false)
    keys.push(first.cacheKey!)
    const cached = new CachedPortfolioSingleIntraNodeSolver({ ...params, portfolioMode })
    cached.step()
    expect(cached.solved).toBe(true)
    expect(cached.cacheHit).toBe(true)
    expect(cached.supervisedSolvers).toBeUndefined()
    expect(cached.solvedRoutes).toEqual(first.solvedRoutes)
  }
  expect(new Set(keys).size).toBe(4)
  const implicitLegacy = new CachedPortfolioSingleIntraNodeSolver(params)
  expect(implicitLegacy.computeCacheKeyAndTransform().cacheKey).toBe(keys[0]!)
  const oldAlias = new CachedPortfolioSingleIntraNodeSolver({ ...params, selectivePortfolio: true })
  expect(oldAlias.portfolioMode).toBe("research-race")
  expect(oldAlias.computeCacheKeyAndTransform().cacheKey).toBe(keys[3]!)
  const processRace = new CachedPortfolioSingleIntraNodeSolver({ ...params,
    portfolioMode: "research-race", selectivePortfolioTiming: "cpu" })
  const elapsedRace = new CachedPortfolioSingleIntraNodeSolver({ ...params,
    portfolioMode: "research-race", selectivePortfolioTiming: "elapsed" })
  expect(processRace.computeCacheKeyAndTransform().cacheKey).not.toBe(elapsedRace.computeCacheKeyAndTransform().cacheKey)
  expect(() => new CachedPortfolioSingleIntraNodeSolver({ ...params,
    portfolioMode: "lazy", selectivePortfolio: true })).toThrow("conflicts")
  expect(() => new CachedPortfolioSingleIntraNodeSolver({ ...params,
    portfolioMode: "invalid" as PortfolioMode })).toThrow("Unsupported portfolio mode")
})
