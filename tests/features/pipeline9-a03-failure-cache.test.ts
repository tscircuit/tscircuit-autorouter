import { expect, test } from "bun:test"
import { HighDensitySolverA03WithFailureCache } from "../../lib/solvers/HyperHighDensitySolver/HighDensitySolverA03WithFailureCache"
import { HighDensitySolverFailureCache } from "../../lib/solvers/HyperHighDensitySolver/HighDensitySolverFailureCache"
import { highDensityFailureCacheNode } from "../fixtures/high-density-failure-cache-node"

test("A03 reuses failed searches only with the same iteration budget", () => {
  const cache = new HighDensitySolverFailureCache()
  const params = {
    nodeWithPortPoints: highDensityFailureCacheNode,
    viaDiameter: 0.3,
    stepMultiplier: 1,
  }
  const original = new HighDensitySolverA03WithFailureCache(params, cache)
  original.MAX_ITERATIONS = 3
  original.solve()
  expect(original.failed).toBeTrue()

  const repeated = new HighDensitySolverA03WithFailureCache(params, cache)
  repeated.MAX_ITERATIONS = 3
  repeated.step()
  expect(repeated.failed).toBeTrue()
  expect(repeated.error).toBe(original.error)
  expect(repeated.iterations).toBe(original.iterations)
  expect(repeated.stats.failureCacheHit).toBeTrue()

  const largerBudget = new HighDensitySolverA03WithFailureCache(params, cache)
  largerBudget.MAX_ITERATIONS = 6
  largerBudget.step()
  expect(largerBudget.failed).toBeFalse()
  expect(largerBudget.stats.failureCacheHit).not.toBeTrue()
})
