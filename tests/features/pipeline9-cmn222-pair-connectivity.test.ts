import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import fixture from "../fixtures/pipeline9-cmn222-regional-five-pair.json"

test("Pipeline9 cmn_222 preserves both source_trace_172 pairs", () => {
  const nodeWithPortPoints = fixture.nodeWithPortPoints as NodeWithPortPoints
  const { connectivityNetMap, ...solverParams } = fixture.solverParams
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints,
    ...solverParams,
    connMap: new ConnectivityMap(connectivityNetMap),
    validateDuplicateConnectionPairs: true,
    prioritizeNextGenerationSolvers: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const pointKey = (point: { x: number; y: number; z: number }): string =>
    [
      point.x.toFixed(6),
      point.y.toFixed(6),
      point.z,
    ].join(",")
  const adjacencyByConnection = new Map<string, Map<string, Set<string>>>()
  for (const route of solver.solvedRoutes) {
    const adjacency =
      adjacencyByConnection.get(route.connectionName) ??
      new Map<string, Set<string>>()
    adjacencyByConnection.set(route.connectionName, adjacency)
    for (let index = 1; index < route.route.length; index++) {
      const startKey = pointKey(route.route[index - 1]!)
      const endKey = pointKey(route.route[index]!)
      const startNeighbors = adjacency.get(startKey) ?? new Set<string>()
      const endNeighbors = adjacency.get(endKey) ?? new Set<string>()
      startNeighbors.add(endKey)
      endNeighbors.add(startKey)
      adjacency.set(startKey, startNeighbors)
      adjacency.set(endKey, endNeighbors)
    }
  }

  const pairIsConnected = ([start, end]: NonNullable<
    NodeWithPortPoints["portPointsInPairs"]
  >[number]): boolean => {
    const adjacency = adjacencyByConnection.get(start.connectionName)
    const targetKey = pointKey(end)
    const visited = new Set<string>([pointKey(start)])
    const pending = [...visited]
    while (pending.length > 0 && !visited.has(targetKey)) {
      const currentKey = pending.pop()!
      for (const neighborKey of adjacency?.get(currentKey) ?? []) {
        if (visited.has(neighborKey)) continue
        visited.add(neighborKey)
        pending.push(neighborKey)
      }
    }
    return visited.has(targetKey)
  }

  const expectedPairs = nodeWithPortPoints.portPointsInPairs!
  expect(expectedPairs).toHaveLength(5)
  expect(expectedPairs.every(pairIsConnected)).toBe(true)

  const sourceTrace172Pairs = expectedPairs.filter(
    ([start]) => start.connectionName === "source_trace_172",
  )
  expect(sourceTrace172Pairs).toHaveLength(2)
  expect(sourceTrace172Pairs.every(pairIsConnected)).toBe(true)
  expect(
    solver.solvedRoutes.filter(
      (route: HighDensityIntraNodeRoute) =>
        route.connectionName === "source_trace_172",
    ).length,
  ).toBeGreaterThanOrEqual(2)
})
