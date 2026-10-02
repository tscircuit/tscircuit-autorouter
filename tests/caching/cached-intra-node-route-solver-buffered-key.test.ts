import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("buffered cache keys preserve typed special values and parameter ordering", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cache-key-types", center: { x: 0, y: 0 }, width: 2, height: 2,
    portPoints: [
      { connectionName: "signal:α", x: -1, y: 0, z: 0 },
      { connectionName: "signal:α", x: 1, y: 0, z: 1 },
    ],
  }
  const key = (penalty: number, reverseOrder = false): string => {
    const hyperParameters = reverseOrder
      ? { SHUFFLE_SEED: 0, VIA_PENALTY_FACTOR_2: penalty }
      : { VIA_PENALTY_FACTOR_2: penalty, SHUFFLE_SEED: 0 }
    const solver = new CachedIntraNodeRouteSolver({ nodeWithPortPoints: node, hyperParameters, cacheProvider: null })
    return solver.computeCacheKeyAndTransform().cacheKey
  }
  const values = [0, 1, NaN, Infinity, -Infinity]
  expect(new Set(values.map((value): string => key(value))).size).toBe(values.length)
  for (const value of values) {
    expect(key(value)).toBe(key(value, true))
    expect(key(value)).toMatch(/^intranode-solver:[a-f0-9]{40}$/)
  }
})
