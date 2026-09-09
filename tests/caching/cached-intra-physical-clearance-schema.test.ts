import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import objectHash from "object-hash"

test("no-context intra-node cache retains schema 7 and rejects versions 4 through 6", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "schema-node",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0, 1],
    portPoints: [
      {
        connectionName: "signal",
        portPointId: "left",
        x: -0.5,
        y: 0,
        z: 0,
      },
      {
        connectionName: "signal",
        portPointId: "right",
        x: 0.5,
        y: 0,
        z: 0,
      },
    ],
  }
  const cacheProvider = new InMemoryCache()
  const solver = new CachedIntraNodeRouteSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    cacheProvider,
  })
  const legacyData = {
    cacheSchemaVersion: 4,
    node: {
      width: 1,
      height: 1,
      center: { x: 0, y: 0 },
      availableZ: [0, 1],
      portPoints: node.portPoints.map((point) => ({
        connectionName: point.connectionName,
        rootConnectionName: undefined,
        portPointId: point.portPointId,
        prevPortPointId: undefined,
        nextPortPointId: undefined,
        x: point.x,
        y: point.y,
        z: point.z,
      })),
    },
    normalizedConnections: [
      {
        connectionName: "signal",
        rootConnectionName: undefined,
        points: node.portPoints.map(({ x, y, z }) => ({
          connectionName: "signal",
          x,
          y,
          z,
        })),
      },
    ],
    normalizedHyperParameters: {},
    minDistBetweenEnteringPoints:
      Math.round(solver.minDistBetweenEnteringPoints * 200) / 200,
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    normalizedConnMap: undefined,
  }
  const options = { respectType: false, unorderedObjects: false }
  const legacyKey = `intranode-solver:${objectHash(legacyData, options)}`
  const previousKey = `intranode-solver:${objectHash(
    { ...legacyData, cacheSchemaVersion: 5 },
    options,
  )}`
  const previousPeerKey = `intranode-solver:${objectHash(
    { ...legacyData, cacheSchemaVersion: 6 },
    options,
  )}`
  const currentKey = `intranode-solver:${objectHash(
    { ...legacyData, cacheSchemaVersion: 7 },
    options,
  )}`
  expect(solver.computeCacheKeyAndTransform().cacheKey).toBe(currentKey)
  expect(currentKey).not.toBe(legacyKey)
  expect(currentKey).not.toBe(previousKey)
  expect(currentKey).not.toBe(previousPeerKey)
  cacheProvider.setCachedSolutionSync(legacyKey, {
    success: false,
    error: "schema 4 result",
  })
  cacheProvider.setCachedSolutionSync(previousKey, {
    success: false,
    error: "schema 5 result",
  })
  cacheProvider.setCachedSolutionSync(previousPeerKey, {
    success: false,
    error: "schema 6 result",
  })
  expect(solver.attemptToUseCacheSync()).toBeFalse()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeFalse()
  expect(solver.iterations).toBe(0)
  expect(cacheProvider.getAllCacheKeys()).toEqual([
    legacyKey,
    previousKey,
    previousPeerKey,
  ])
})
