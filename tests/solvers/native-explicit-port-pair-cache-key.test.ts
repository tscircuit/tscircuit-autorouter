import { expect, test } from "bun:test"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { actualNet299Node } from "./nativeExplicitPairTestUtils"

test("native cache identity includes explicit pairing even when port metadata is unchanged", (): void => {
  const node = structuredClone(actualNet299Node)
  const params = { nodeWithPortPoints: node, cacheProvider: null }
  const original = new CachedIntraNodeRouteSolver(params)
  const originalKey = original.computeCacheKeyAndTransform().cacheKey
  const [a, b, c, d] = node.portPoints
  const alternate = new CachedIntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: {
      ...node,
      portPointsInPairs: [
        [a, d],
        [b, c],
      ],
    },
  })
  expect(alternate.computeCacheKeyAndTransform().cacheKey).not.toBe(originalKey)
  const duplicate = new CachedIntraNodeRouteSolver({
    ...params,
    nodeWithPortPoints: {
      ...node,
      portPointsInPairs: [
        ...node.portPointsInPairs!,
        node.portPointsInPairs![0],
      ],
    },
  })
  expect(duplicate.unsolvedConnections).toHaveLength(3)
  expect(duplicate.computeCacheKeyAndTransform().cacheKey).not.toBe(originalKey)
  const ids = duplicate.unsolvedConnections.map((task) =>
    Reflect.get(task, "routeEventId"),
  )
  expect(new Set(ids).size).toBe(3)
  expect(node).toEqual(actualNet299Node)
})
