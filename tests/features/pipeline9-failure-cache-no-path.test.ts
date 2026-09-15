import { expect, test } from "bun:test"
import { HighDensitySolverA01WithFailureCache } from "../../lib/solvers/HyperHighDensitySolver/HighDensitySolverA01WithFailureCache"
import { HighDensitySolverFailureCache } from "../../lib/solvers/HyperHighDensitySolver/HighDensitySolverFailureCache"
import { highDensityFailureCacheNode } from "../fixtures/high-density-failure-cache-node"

test("a repeated no-path search preserves the original failure", () => {
  const cache = new HighDensitySolverFailureCache()
  const params = {
    nodeWithPortPoints: {
      ...highDensityFailureCacheNode,
      width: 0.3,
      height: 0.3,
      portPoints: highDensityFailureCacheNode.portPoints.map((point) => ({
        ...point,
        x: point.x / 10,
        y: point.y / 10,
      })),
    },
    cellSizeMm: 0.1,
    viaDiameter: 0.3,
  }
  const original = new HighDensitySolverA01WithFailureCache(params, cache)
  original.solve()
  expect(original.failed).toBeTrue()
  expect(original.error).toBe("No path found for b")
  expect(original.iterations).toBeLessThan(original.MAX_ITERATIONS)

  const repeated = new HighDensitySolverA01WithFailureCache(params, cache)
  repeated.step()
  expect(repeated.failed).toBeTrue()
  expect(repeated.solved).toBeFalse()
  expect(repeated.error).toBe(original.error)
  expect(repeated.iterations).toBe(original.iterations)
  expect(repeated.stats.failureCacheHit).toBeTrue()
})
