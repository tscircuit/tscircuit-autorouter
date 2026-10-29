import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { createFuturePointCacheStats, mixFuturePointCacheKey, registerOwnedFuturePointCacheOptions } from "lib/solvers/HighDensitySolver/futurePointCacheContext"
import { makeFuturePointOptions, queryNode } from "./fixtures/futurePointCacheSynthetic"

test("lean census records first actual modified use once and performs no later telemetry writes", () => {
  const writes: PropertyKey[] = []
  const stats = new Proxy(createFuturePointCacheStats(), { set(target, key, value): boolean {
    writes.push(key)
    return Reflect.set(target, key, value)
  } })
  const opts = makeFuturePointOptions(8)
  registerOwnedFuturePointCacheOptions(opts, stats)
  const owned = new Native(opts)
  const reference = new Native(opts)
  expect(stats).toEqual({ instances: 1, contextsUsed: 0 })
  expect(writes).toEqual(["instances"])
  const original = owned.futureConnectionPoints
  const unsafe = queryNode(Infinity, 0, 0)
  expect(owned.getClosestFutureConnectionPoint(unsafe)).toBe(reference.getClosestFutureConnectionPoint(unsafe))
  owned.futureConnectionPoints = original.slice(0, 7)
  reference.futureConnectionPoints = owned.futureConnectionPoints
  expect(owned.getClosestFutureConnectionPoint(queryNode(0, 0, 0))).toBe(reference.getClosestFutureConnectionPoint(queryNode(0, 0, 0)))
  expect(stats.contextsUsed).toBe(0)
  expect(writes).toEqual(["instances"])
  owned.futureConnectionPoints = original
  reference.futureConnectionPoints = original
  let query = queryNode(0, 0, 0)
  for (let index = 0; index < 100; index++) {
    query = queryNode(index * .05, 0, 0)
    const key = owned.getNodeKey(query)
    if ((mixFuturePointCacheKey(key) & 255) !== Math.abs(key % 256)) break
  }
  const key = owned.getNodeKey(query)
  const slot = mixFuturePointCacheKey(key) & 255
  expect(slot).not.toBe(Math.abs(key % 256))
  expect(owned.getClosestFutureConnectionPoint(query)).toBe(reference.getClosestFutureConnectionPoint(query))
  expect((owned as any).closestFuturePointCacheCoordinates[slot * 4]).toBe(query.x)
  expect(stats).toEqual({ instances: 1, contextsUsed: 1 })
  expect(writes).toEqual(["instances", "contextsUsed"])
  Object.freeze(stats)
  for (let index = 0; index < 1000; index++) {
    const node = queryNode((index * 17 % 91 - 45) * .05, (index * 13 % 87 - 43) * .05, index % 4)
    expect(owned.getClosestFutureConnectionPoint(node)).toBe(reference.getClosestFutureConnectionPoint(node))
  }
  expect(writes).toEqual(["instances", "contextsUsed"])
  expect(stats.contextsUsed).toBeLessThanOrEqual(stats.instances)
})
