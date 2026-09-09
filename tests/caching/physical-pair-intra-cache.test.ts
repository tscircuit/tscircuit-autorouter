import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { PhysicalIntraNodeConnectionTask } from "lib/solvers/HighDensitySolver/getPhysicalIntraNodeConnectionTasks"
import objectHash from "object-hash"
import { createIntraNodePhysicalPairProblem } from "../fixtures/intraNodePhysicalPairs"
import { createPreviousPhysicalPairCacheData } from "../fixtures/physicalPairCacheSchema"

type NormalizedTask = {
  connectionName: string
  rootConnectionName?: string
  points: Array<{ connectionName: string; x: number; y: number; z: number }>
}

type NormalizedNet = {
  connectionName: string
  connectedIds: string[]
}

test("physical intra-node cache separates pair obligations and rejects old name-grouped entries", (): void => {
  const { node, pairs, params } = createIntraNodePhysicalPairProblem()
  const originalNode = structuredClone(node)
  const cache = new InMemoryCache()
  const solver = new CachedIntraNodeRouteSolver({
    ...params,
    cacheProvider: cache,
  })
  const oldData = createPreviousPhysicalPairCacheData(solver).intra
  const oldKey = `intranode-solver:${objectHash(oldData, {
    respectType: false,
    unorderedObjects: false,
  })}`
  cache.setCachedSolutionSync(oldKey, {
    success: false,
    error: "old star failure",
  })
  const key = solver.computeCacheKeyAndTransform().cacheKey
  const oldPhysicalData = oldData.physicalClearance
  if (typeof oldPhysicalData !== "object" || oldPhysicalData === null) {
    throw new Error("The previous cache fixture requires physical key data")
  }
  const expectedTasks = pairs.map(
    ([start, end]): PhysicalIntraNodeConnectionTask => ({
      connectionName: start.connectionName,
      rootConnectionName: start.rootConnectionName,
      points: [{ ...start }, { ...end }],
    }),
  )
  const expectedKey = `intranode-solver:${objectHash(
    {
      ...oldData,
      cacheSchemaVersion: 8,
      normalizedConnections: expectedTasks.map(
        (task): NormalizedTask => ({
          connectionName: task.connectionName,
          rootConnectionName: task.rootConnectionName,
          points: task.points.map(
            ({ x, y, z }): NormalizedTask["points"][number] => ({
              connectionName: task.connectionName,
              x,
              y,
              z,
            }),
          ),
        }),
      ),
      normalizedConnMap: expectedTasks.map(
        ({ connectionName }): NormalizedNet => ({
          connectionName,
          connectedIds: [
            ...new Set(
              params.connMap!.getIdsConnectedToNet(connectionName) ?? [],
            ),
          ].sort(),
        }),
      ),
      physicalClearance: { ...oldPhysicalData, connections: expectedTasks },
    },
    { respectType: false, unorderedObjects: false },
  )}`
  expect(key).toBe(expectedKey)
  expect(key).not.toBe(oldKey)
  expect(solver.attemptToUseCacheSync()).toBeFalse()
  expect(solver.failed).toBeFalse()
  expect(solver.iterations).toBe(0)

  const [a, b, c, d] = node.portPoints
  if (!a || !b || !c || !d) throw new Error("Expected four fixture ports")
  const changed = new CachedIntraNodeRouteSolver({
    ...params,
    cacheProvider: null,
    nodeWithPortPoints: {
      ...node,
      portPointsInPairs: [
        [a, c],
        [b, d],
      ],
    },
  })
  expect(changed.computeCacheKeyAndTransform().cacheKey).not.toBe(key)
  expect(changed.iterations).toBe(0)
  const equivalent = new CachedIntraNodeRouteSolver({
    ...params,
    cacheProvider: null,
    nodeWithPortPoints: structuredClone(node),
  })
  expect(equivalent.computeCacheKeyAndTransform().cacheKey).toBe(key)
  expect(node).toEqual(originalNode)
})
