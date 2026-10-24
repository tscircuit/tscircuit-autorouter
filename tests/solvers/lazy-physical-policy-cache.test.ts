import { withDetailedWork } from "./lazyPhysicalTestUtils"
import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"

test("lazy routing is opt-in below Pipeline9 and has a separate completed-result cache identity", () => withDetailedWork(() => {
  const params = { nodeWithPortPoints: { capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 4,
    height: 4, portPoints: [{ x: -2, y: -1, z: 0, connectionName: "a", rootConnectionName: "root" },
      { x: 2, y: 1, z: 0, connectionName: "a", rootConnectionName: "root" }], availableZ: [0, 1] },
    cacheProvider: null, viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15 }
  const native = new CachedIntraNodeRouteSolver(params)
  const explicitNative = new CachedIntraNodeRouteSolver({ ...params, lazyPhysicalEvaluation: false })
  const lazy = new CachedIntraNodeRouteSolver({ ...params, lazyPhysicalEvaluation: true })
  expect(native.lazyPhysicalEvaluation).toBe(false)
  expect(native.computeCacheKeyAndTransform().cacheKey).toBe(explicitNative.computeCacheKeyAndTransform().cacheKey)
  expect(lazy.computeCacheKeyAndTransform().cacheKey).not.toBe(native.computeCacheKeyAndTransform().cacheKey)
  lazy.step()
  expect(lazy.activeSubSolver?.constructor.name).toBe("LazyPhysicalSingleHighDensityRouteSolver")
  native.step()
  expect(native.activeSubSolver?.constructor.name).toBe("SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost")
}))
