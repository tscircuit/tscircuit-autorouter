import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { HighDensityHyperParameters } from "lib/solvers/HighDensitySolver/HighDensityHyperParameters"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("serialized cache keys preserve hyperparameter order and non-finite distinctions", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "serialized-cache-key",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "a:[]\"undefined", x: -1, y: 0, z: 0 },
      { connectionName: "a:[]\"undefined", x: 1, y: 0, z: 0 },
    ],
  }
  const getKey = (hyperParameters: Partial<HighDensityHyperParameters>): string => {
    const solver = new CachedIntraNodeRouteSolver({
      nodeWithPortPoints: node,
      hyperParameters,
      cacheProvider: null,
    })
    return solver.computeCacheKeyAndTransform().cacheKey
  }
  expect(getKey({ SHUFFLE_SEED: 2, CELL_SIZE_FACTOR: 1 })).toBe(
    getKey({ CELL_SIZE_FACTOR: 1, SHUFFLE_SEED: 2 }),
  )
  expect(getKey({ SHUFFLE_SEED: 2, CELL_SIZE_FACTOR: undefined })).toBe(
    getKey({ SHUFFLE_SEED: 2 }),
  )
  const keys = [undefined, 0, 1, Number.NaN, Infinity, -Infinity].map(
    (ITERATION_PENALTY) => getKey({ ITERATION_PENALTY }),
  )
  expect(new Set(keys).size).toBe(keys.length)
  expect(keys.every((key) => /^intranode-solver:[a-f0-9]{40}$/.test(key))).toBe(true)
})
