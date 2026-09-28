import { expect, test } from "bun:test"
import {
  PortPointPathingSolver,
  type InputNodeWithPortPoints,
  type InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"

test("ripping a route preserves ports used by a surviving same-net route", () => {
  const port: InputPortPoint = {
    portPointId: "shared-port",
    x: 0,
    y: 0,
    z: 0,
    connectionNodeIds: ["left", "right"],
    distToCentermostPortOnZ: 0,
  }
  const nodes: InputNodeWithPortPoints[] = [-1, 1].map((x, index) => ({
    capacityMeshNodeId: index === 0 ? "left" : "right",
    center: { x, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [port],
    _containsTarget: true,
  }))
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 2, minY: -1, maxY: 1 },
    obstacles: [],
    connections: ["branch-a", "branch-b"].map((name, index) => ({
      name,
      __rootConnectionNames: ["shared-net"],
      pointsToConnect: [
        { x: -1, y: index * 0.2, layer: "top" },
        { x: 1, y: index * 0.2, layer: "top" },
      ],
    })),
  }
  const solver = new PortPointPathingSolver({
    simpleRouteJson: srj,
    inputNodes: nodes,
    capacityMeshNodes: nodes.map((node) => ({ ...node, layer: "top" })),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.connectionsWithResults.every((result) => result.path)).toBe(
    true,
  )

  const owner = solver.assignedPortPoints.get("shared-port")!
  const ripped = solver.connectionsWithResults.find(
    (result) => result.connection.name === owner.connectionName,
  )!
  const surviving = solver.connectionsWithResults.find(
    (result) => result !== ripped,
  )!
  solver.ripConnection(ripped)

  expect(ripped.path).toBeUndefined()
  expect(surviving.path).toBeDefined()
  expect(solver.assignedPortPoints.get("shared-port")).toEqual({
    connectionName: surviving.connection.name,
    rootConnectionName: "shared-net",
  })
  solver.currentConnection = {
    ...ripped,
    connection: { ...ripped.connection, __rootConnectionNames: ["other-net"] },
  }
  expect(solver.getAvailableExitPortPoints("left")).toEqual([])
  expect(
    solver.getAvailableExitPortPointsWithOmissions("left", "right"),
  ).toEqual([])

  solver.ripConnection(surviving)
  expect(solver.assignedPortPoints.has("shared-port")).toBe(false)
})
