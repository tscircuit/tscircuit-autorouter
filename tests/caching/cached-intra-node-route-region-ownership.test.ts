import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("cached node geometry keeps cache hits while rebinding the current region", (): void => {
  const cacheProvider = new InMemoryCache()
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "original_node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "signal_a", x: -1, y: -0.5, z: 0 },
      { connectionName: "signal_a", x: 1, y: -0.5, z: 0 },
      { connectionName: "signal_b", x: -1, y: 0.5, z: 1 },
      { connectionName: "signal_b", x: 1, y: 0.5, z: 1 },
    ],
  }
  const params = {
    cacheProvider,
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    hyperParameters: { SHUFFLE_SEED: 0 },
  }
  const originalSolver = new CachedIntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: node,
  })
  originalSolver.solve()
  expect(originalSolver.solved).toBeTrue()
  expect(originalSolver.cacheHit).toBeFalse()
  const cachedGeometry = structuredClone(originalSolver.solvedRoutes)
  const newNodeSolver = new CachedIntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: { ...node, capacityMeshNodeId: "current_node" },
  })
  expect(newNodeSolver.computeCacheKeyAndTransform().cacheKey).toBe(
    originalSolver.cacheKey!,
  )
  newNodeSolver.solve()
  expect(newNodeSolver.solved).toBeTrue()
  expect(newNodeSolver.cacheHit).toBeTrue()
  expect(newNodeSolver.solvedRoutes).toEqual(
    cachedGeometry.map((route) => ({ ...route, regionId: "current_node" })),
  )
  expect(
    cacheProvider.getCachedSolutionSync(originalSolver.cacheKey!).solvedRoutes,
  ).toEqual(cachedGeometry)
  expect(originalSolver.solvedRoutes).toEqual(cachedGeometry)
})
