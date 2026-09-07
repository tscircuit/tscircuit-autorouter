import { expect, test } from "bun:test"
import { InMemoryCache } from "lib/cache/InMemoryCache"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { prepareIntraNodeRouteSolverConnections } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("prepared portfolio connections preserve routes and isolate candidate state", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "prepared-connections",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "a", rootConnectionName: "root-a", x: -2, y: -1, z: 0 },
      { connectionName: "a", rootConnectionName: "root-a", x: -2 + 1e-8, y: -1, z: 0 },
      { connectionName: "a", rootConnectionName: "root-a", x: 2, y: -1, z: 0 },
      { connectionName: "b", rootConnectionName: "root-b", x: -2, y: 1, z: 0 },
      { connectionName: "b", rootConnectionName: "root-b", x: 2, y: 1, z: 0 },
    ],
  }
  const preparedConnections = prepareIntraNodeRouteSolverConnections(node)
  for (const seed of [0, 1, 5, 100]) {
    const options = {
      nodeWithPortPoints: node,
      hyperParameters: { SHUFFLE_SEED: seed },
      captureSearchDebug: false,
    }
    const standalone = new CachedIntraNodeRouteSolver({
      ...options,
      cacheProvider: new InMemoryCache(),
    })
    const prepared = new CachedIntraNodeRouteSolver({
      ...options,
      preparedConnections,
      cacheProvider: new InMemoryCache(),
    })
    expect(prepared.unsolvedConnections).toEqual(standalone.unsolvedConnections)
    expect(prepared.minDistBetweenEnteringPoints).toBe(standalone.minDistBetweenEnteringPoints)
    expect(prepared.computeCacheKeyAndTransform().cacheKey).toBe(
      standalone.computeCacheKeyAndTransform().cacheKey,
    )
    standalone.solve()
    prepared.solve()
    expect(prepared.solved).toBe(true)
    expect(prepared.solvedRoutes).toEqual(standalone.solvedRoutes)
    expect(prepared.iterations).toBe(standalone.iterations)
  }
  const first = new CachedIntraNodeRouteSolver({ nodeWithPortPoints: node, preparedConnections })
  const second = new CachedIntraNodeRouteSolver({ nodeWithPortPoints: node, preparedConnections })
  const key = first.computeCacheKeyAndTransform().cacheKey
  first.unsolvedConnections[0]!.points[0]!.x = 123
  first.unsolvedConnections.pop()
  first.rootConnectionNameByConnectionName.set("a", "changed")
  expect(second.unsolvedConnections[0]!.points[0]!.x).toBe(-2)
  expect(second.unsolvedConnections.length).toBe(2)
  expect(second.rootConnectionNameByConnectionName.get("a")).toBe("root-a")
  expect(preparedConnections.connections[0]!.points[0]!.x).toBe(-2)
  expect(first.computeCacheKeyAndTransform().cacheKey).toBe(key)
})
