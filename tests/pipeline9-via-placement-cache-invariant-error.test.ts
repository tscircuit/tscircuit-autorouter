import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { createPipeline9ViaPlacementProposalHarness } from "./fixtures/pipeline9ViaPlacementProposalHarness"

test("a via-placement invariant error from cached geometry propagates beyond the I/O boundary", () => {
  const { input, node } = createPipeline9ViaPlacementProposalHarness()
  const cache = new InMemoryCache()
  const sentinel = new Error("original via-placement ownership invariant")
  const solver = new CachedIntraNodeRouteSolver({ nodeWithPortPoints: node,
    layerCount: 4, cacheProvider: cache,
    viaPlacementValidator: (): boolean => { throw sentinel },
  })
  solver.cacheKey = "intranode-solver:placement-invariant-control"
  cache.setCachedSolutionSync(solver.cacheKey, { success: true, solvedRoutes: [input] })
  expect(() => solver.attemptToUseCacheSync()).toThrow(sentinel)
  expect(solver.solved).toBe(false)
  expect(solver.cacheHit).toBe(false)
})
