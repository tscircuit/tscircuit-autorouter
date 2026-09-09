import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { CachedPortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/CachedPortfolioSingleIntraNodeSolver"
import objectHash from "object-hash"
import { createIntraNodePhysicalPairProblem } from "../fixtures/intraNodePhysicalPairs"
import { createPreviousPhysicalPairCacheData } from "../fixtures/physicalPairCacheSchema"

test("physical portfolio cache rejects schema7 for the identical node and preserves exact pair identity", (): void => {
  const { node, params } = createIntraNodePhysicalPairProblem()
  const originalNode = structuredClone(node)
  const cache = new InMemoryCache()
  const data = createPreviousPhysicalPairCacheData(
    new IntraNodeRouteSolver(params),
  ).portfolio
  const oldKey = `intranode:${objectHash(data)}`
  const expectedKey = `intranode:${objectHash({
    ...data,
    cacheSchemaVersion: 8,
  })}`
  cache.setCachedSolutionSync(oldKey, { success: false })
  const solver = new CachedPortfolioSingleIntraNodeSolver({
    ...params,
    cacheProvider: cache,
  })
  expect(solver.computeCacheKeyAndTransform().cacheKey).toBe(expectedKey)
  expect(expectedKey).not.toBe(oldKey)
  expect(solver.attemptToUseCacheSync()).toBeFalse()
  expect(solver.failed).toBeFalse()
  expect(solver.iterations).toBe(0)

  const [a, b, c, d] = node.portPoints
  if (!a || !b || !c || !d) throw new Error("Expected four fixture ports")
  const changed = new CachedPortfolioSingleIntraNodeSolver({
    ...params,
    cacheProvider: null,
    nodeWithPortPoints: {
      ...node,
      portPointsInPairs: [
        [a, c],
        [b, d],
      ],
    },
  })
  expect(changed.computeCacheKeyAndTransform().cacheKey).not.toBe(expectedKey)
  expect(changed.iterations).toBe(0)
  expect(node).toEqual(originalNode)
})
