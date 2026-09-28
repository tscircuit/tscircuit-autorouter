import { expect, test } from "bun:test"
import {
  PortPointPathingSolver,
  type InputNodeWithPortPoints,
  type InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"

test("ripping preserves unused off-board ports reserved by a surviving route", () => {
  const ports: InputPortPoint[] = [
    {
      portPointId: "entry", x: -2, y: 0, z: 0,
      connectionNodeIds: ["start", "off-left"],
      distToCentermostPortOnZ: 0,
    },
    {
      portPointId: "exit", x: 2, y: 0, z: 0,
      connectionNodeIds: ["off-right", "end"],
      distToCentermostPortOnZ: 0,
    },
    {
      portPointId: "reserved-only", x: 1, y: 1, z: 0,
      connectionNodeIds: ["off-right", "spare"],
      distToCentermostPortOnZ: 0,
    },
  ]
  const nodes: InputNodeWithPortPoints[] = [
    { capacityMeshNodeId: "start", center: { x: -3, y: 0 }, _containsTarget: true },
    {
      capacityMeshNodeId: "off-left", center: { x: -1, y: 0 },
      _offBoardConnectionId: "off-board",
      _offBoardConnectedCapacityMeshNodeIds: ["off-left", "off-right"],
    },
    {
      capacityMeshNodeId: "off-right", center: { x: 1, y: 0 },
      _offBoardConnectionId: "off-board",
      _offBoardConnectedCapacityMeshNodeIds: ["off-left", "off-right"],
    },
    { capacityMeshNodeId: "end", center: { x: 3, y: 0 }, _containsTarget: true },
    { capacityMeshNodeId: "spare", center: { x: 1, y: 2 } },
  ].map((node): InputNodeWithPortPoints => ({
    ...node,
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: ports.filter((port): boolean =>
      port.connectionNodeIds.includes(node.capacityMeshNodeId)),
  }))
  const srj: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.1,
    bounds: { minX: -4, maxX: 4, minY: -1, maxY: 3 },
    obstacles: [],
    connections: ["branch-a", "branch-b"].map((name, index) => ({
      name,
      __rootConnectionNames: ["shared-net"],
      pointsToConnect: [
        { x: -3, y: index * 0.2, layer: "top" },
        { x: 3, y: index * 0.2, layer: "top" },
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
  for (const result of solver.connectionsWithResults) {
    expect(result.portPoints?.some((port) => port.portPointId === "reserved-only")).toBe(false)
  }

  const owner = solver.assignedPortPoints.get("reserved-only")!
  expect(owner).toBeDefined()
  const ripped = solver.connectionsWithResults.find(
    (result) => result.connection.name === owner.connectionName,
  )!
  const surviving = solver.connectionsWithResults.find((result) => result !== ripped)!
  solver.ripConnection(ripped)
  expect(solver.assignedPortPoints.get("reserved-only")).toEqual({
    connectionName: surviving.connection.name,
    rootConnectionName: "shared-net",
  })
  solver.currentConnection = {
    ...ripped,
    connection: { ...ripped.connection, __rootConnectionNames: ["other-net"] },
  }
  expect(solver.getAvailableExitPortPointsForOffboardConnection("off-left")).toEqual([])
  solver.ripConnection(surviving)
  expect(solver.assignedPortPoints.has("reserved-only")).toBe(false)
})
