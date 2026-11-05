import { expect, test } from "bun:test"
import sample024 from "@tscircuit/dataset-srj24/samples/sample024.json"
import { DisjointSet } from "lib/solvers/NetToPointPairsSolver/buildMinimumSpanningTree"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"

test("SRJ24 sample024 retains every required net connection", (): void => {
  const input: SimpleRouteJson = structuredClone(sample024)
  const original = structuredClone(input)
  const solver = new NetToPointPairsSolver(
    input,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(input),
  )
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.newConnections).toHaveLength(1029)
  expect(input).toEqual(original)
  for (const connection of input.connections) {
    const points = connection.pointsToConnect
    const connected = new DisjointSet(points)
    const pointsById = new Map(points.map((point) => [point.pointId, point]))
    for (const group of connection.externallyConnectedPointIds ?? []) {
      const first = pointsById.get(group[0]!)
      expect(first).toBeDefined()
      for (const pointId of group.slice(1)) {
        const point = pointsById.get(pointId)
        expect(point).toBeDefined()
        connected.union(first!, point!)
      }
    }
    for (const pair of solver.newConnections) {
      if (!pair.__rootConnectionNames?.includes(connection.name)) continue
      connected.union(pair.pointsToConnect[0]!, pair.pointsToConnect[1]!)
    }
    expect(connected.componentCount).toBe(1)
  }
})
