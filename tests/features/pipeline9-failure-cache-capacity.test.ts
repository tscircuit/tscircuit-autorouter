import { expect, test } from "bun:test"
import { HighDensitySolverA01WithFailureCache } from "../../lib/solvers/HyperHighDensitySolver/HighDensitySolverA01WithFailureCache"
import { HighDensitySolverFailureCache } from "../../lib/solvers/HyperHighDensitySolver/HighDensitySolverFailureCache"
import { highDensityFailureCacheNode } from "../fixtures/high-density-failure-cache-node"

test("bounded failure caching searches again after an entry is evicted", () => {
  const cache = new HighDensitySolverFailureCache(2)
  const params = {
    nodeWithPortPoints: highDensityFailureCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    stepMultiplier: 1,
  }
  for (const width of [3, 3.05, 3.1]) {
    const solver = new HighDensitySolverA01WithFailureCache(
      {
        ...params,
        nodeWithPortPoints: { ...highDensityFailureCacheNode, width },
      },
      cache,
    )
    solver.MAX_ITERATIONS = 3
    solver.solve()
    expect(solver.failed).toBeTrue()
  }
  const evicted = new HighDensitySolverA01WithFailureCache(params, cache)
  evicted.MAX_ITERATIONS = 3
  evicted.step()
  expect(evicted.failed).toBeFalse()
  expect(evicted.stats.failureCacheHit).not.toBeTrue()
})
