import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  CachedIntraNodeRouteSolver,
  type CachedSolvedIntraNodeRouteSolver,
} from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { IntraNodePhysicalClearanceContext } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("physical context changes isolate cached successes and failures without routing", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "entry-isolation-node",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "signal", x: -0.5, y: 0, z: 0 },
      { connectionName: "signal", x: 0.5, y: 0, z: 0 },
    ],
  }
  const clearIndex = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.1,
  })
  const blockedIndex = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 0.2,
        height: 0.2,
        zLayers: [0],
        ownerNetIds: new Set(["foreign"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.1,
  })
  const context: IntraNodePhysicalClearanceContext = {
    traceClearanceIndex: clearIndex,
    viaClearanceIndex: clearIndex,
    canonicalNetIdByConnectionName: new Map([["signal", "signal"]]),
    solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
  }
  const cachedValues: CachedSolvedIntraNodeRouteSolver[] = [
    {
      success: true,
      solvedRoutes: [
        {
          connectionName: "signal",
          traceThickness: 0.15,
          viaDiameter: 0.3,
          route: [
            { x: -0.5, y: 0, z: 0 },
            { x: 0.5, y: 0, z: 0 },
          ],
          vias: [],
        },
      ],
    },
    { success: false, error: "stored failure in a different physical domain" },
  ]
  for (const cachedValue of cachedValues) {
    const cacheProvider = new InMemoryCache()
    const params = {
      nodeWithPortPoints: node,
      traceWidth: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.1,
      layerCount: 2,
      physicalClearanceContext: context,
      cacheProvider,
    }
    const original = new CachedIntraNodeRouteSolver(params)
    const key = original.computeCacheKeyAndTransform().cacheKey
    cacheProvider.setCachedSolutionSync(key, cachedValue)
    const changed = new CachedIntraNodeRouteSolver({
      ...params,
      physicalClearanceContext: {
        ...context,
        traceClearanceIndex: blockedIndex,
      },
    })
    expect(changed.attemptToUseCacheSync()).toBeFalse()
    expect(changed.cacheHit).toBeFalse()
    expect(changed.solved).toBeFalse()
    expect(changed.failed).toBeFalse()
    expect(changed.solvedRoutes).toEqual([])
    expect(changed.iterations).toBe(0)

    const equivalent = new CachedIntraNodeRouteSolver(params)
    expect(equivalent.attemptToUseCacheSync()).toBeTrue()
    expect(equivalent.cacheHit).toBeTrue()
    expect(equivalent.solved).toBe(cachedValue.success)
    expect(equivalent.failed).toBe(!cachedValue.success)
    if (cachedValue.success) {
      expect(equivalent.solvedRoutes).toEqual(cachedValue.solvedRoutes)
    } else {
      const expectedError = cachedValue.error
      if (typeof expectedError !== "string") {
        throw new Error("Cached failure fixture requires an error message")
      }
      expect(equivalent.error).toBe(expectedError)
    }
    expect(equivalent.iterations).toBe(0)
    expect(cacheProvider.cacheHits).toBe(1)
    expect(cacheProvider.cacheMisses).toBe(1)
  }
})
