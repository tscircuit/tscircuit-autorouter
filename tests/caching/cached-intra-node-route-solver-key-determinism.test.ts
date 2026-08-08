import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const makeNode = (): NodeWithPortPoints => ({
  capacityMeshNodeId: "cmn_test",
  center: { x: 0, y: 0 },
  width: 2,
  height: 1,
  availableZ: [0, 1],
  portPoints: [
    { connectionName: "A", x: -1, y: -0.5, z: 0 },
    { connectionName: "A", x: 1, y: -0.5, z: 0 },
    { connectionName: "B", x: -1, y: 0.5, z: 1 },
    { connectionName: "B", x: 1, y: 0.5, z: 1 },
  ],
})

test("equivalent inputs produce the same SHA-1 cache key", () => {
  const solverOptions = {
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    hyperParameters: { SHUFFLE_SEED: 0 },
  }
  const firstSolver = new CachedIntraNodeRouteSolver({
    ...solverOptions,
    nodeWithPortPoints: makeNode(),
  })
  const secondSolver = new CachedIntraNodeRouteSolver({
    ...solverOptions,
    nodeWithPortPoints: makeNode(),
  })

  const firstKey = firstSolver.computeCacheKeyAndTransform().cacheKey
  const secondKey = secondSolver.computeCacheKeyAndTransform().cacheKey

  expect(firstKey).toBe(secondKey)
  expect(firstKey).toMatch(/^intranode-solver:[a-f0-9]{40}$/)
})
