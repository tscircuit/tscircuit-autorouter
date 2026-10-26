import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { StaticSegmentValidator } from "lib/types/high-density-types"

test("static physical context bypasses geometry-agnostic cache reads and writes", (): void => {
  const node = {
    capacityMeshNodeId: "cached-wire",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [
      { x: -0.8, y: 0, z: 0, connectionName: "signal" },
      { x: 0.8, y: 0, z: 0, connectionName: "signal" },
    ],
  }
  const original = structuredClone(node)
  const cacheProvider = new InMemoryCache()
  const params = {
    nodeWithPortPoints: node,
    cacheProvider,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
  }
  const unguarded = new CachedIntraNodeRouteSolver(params)
  unguarded.solve()
  expect(unguarded.solved).toBe(true)
  expect(unguarded.solvedRoutes[0]!.route).toHaveLength(2)
  const originalCache = structuredClone(cacheProvider.cache)
  expect(originalCache.size).toBeGreaterThan(0)
  const valid: StaticSegmentValidator = (segment) =>
    segmentToBoundsMinDistance(segment.start, segment.end, {
      minX: -0.1,
      maxX: 0.1,
      minY: -0.3,
      maxY: 0.3,
    }) >=
    segment.traceThickness / 2
  const guarded = new CachedIntraNodeRouteSolver({
    ...params,
    staticSegmentValidator: valid,
  })
  expect(guarded.cacheProvider).toBeNull()
  guarded.solve()
  expect(guarded.solved).toBe(true)
  expect(guarded.cacheHit).toBe(false)
  expect(cacheProvider.cacheHits).toBe(0)
  expect(cacheProvider.cache).toEqual(originalCache)
  for (const route of guarded.solvedRoutes) {
    for (let index = 1; index < route.route.length; index++)
      expect(
        valid({
          connectionName: route.connectionName,
          rootConnectionName: route.rootConnectionName,
          traceThickness: route.traceThickness,
          viaDiameter: route.viaDiameter,
          start: route.route[index - 1]!,
          end: route.route[index]!,
        }),
      ).toBe(true)
  }
  const legacy = new CachedIntraNodeRouteSolver(params)
  legacy.solve()
  expect(legacy.solved).toBe(true)
  expect(legacy.cacheHit).toBe(true)
  expect(legacy.solvedRoutes).toEqual(unguarded.solvedRoutes)
  expect(node).toEqual(original)
})
