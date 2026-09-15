import { expect, test } from "bun:test"
import { HighDensitySolverA01WithFailureCache } from "../../lib/solvers/HyperHighDensitySolver/HighDensitySolverA01WithFailureCache"
import { HighDensitySolverFailureCache } from "../../lib/solvers/HyperHighDensitySolver/HighDensitySolverFailureCache"
import { highDensityFailureCacheNode } from "../fixtures/high-density-failure-cache-node"

test("an in-progress budget change cannot populate the failure cache", () => {
  const cache = new HighDensitySolverFailureCache()
  const params = {
    nodeWithPortPoints: highDensityFailureCacheNode,
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
    stepMultiplier: 1,
  }
  const original = new HighDensitySolverA01WithFailureCache(params, cache)
  original.MAX_ITERATIONS = 3
  original.step()
  original.MAX_ITERATIONS = 6
  original.solve()
  expect(original.failed).toBeTrue()

  for (const iterationLimit of [3, 6]) {
    const repeated = new HighDensitySolverA01WithFailureCache(params, cache)
    repeated.MAX_ITERATIONS = iterationLimit
    repeated.step()
    expect(repeated.failed).toBeFalse()
    expect(repeated.stats.failureCacheHit).not.toBeTrue()
  }
})
