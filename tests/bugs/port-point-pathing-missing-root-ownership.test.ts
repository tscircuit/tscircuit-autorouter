import { expect, test } from "bun:test"
import {
  PortPointPathingSolver,
  type InputNodeWithPortPoints,
  type InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"

test("connections without root metadata cannot share an occupied port", () => {
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
    connections: ["net-a", "net-b"].map((name, index) => ({
      name,
      pointsToConnect: [
        { x: -1, y: index * 0.2, layer: "top" },
        { x: 1, y: index * 0.2, layer: "top" },
      ],
    })),
  }

  for (const forceCenterFirst of [false, true]) {
    const solver = new PortPointPathingSolver({
      simpleRouteJson: srj,
      inputNodes: nodes,
      capacityMeshNodes: nodes.map((node) => ({ ...node, layer: "top" })),
      hyperParameters: { FORCE_CENTER_FIRST: forceCenterFirst },
    })
    solver.solve()

    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    const routed = solver.connectionsWithResults.filter((result) => result.path)
    expect(routed).toHaveLength(1)
    expect(routed[0].portPoints?.map((point) => point.portPointId)).toEqual([
      "shared-port",
    ])
    expect(solver.assignedPortPoints.get("shared-port")?.connectionName).toBe(
      routed[0].connection.name,
    )
    expect(solver.getPortPointReusePenalty("shared-port")).toBe(
      solver.PORT_POINT_REUSE_FACTOR,
    )

    // The off-board exit selector must use the same ownership rule.
    nodes[0]._offBoardConnectedCapacityMeshNodeIds = ["right"]
    solver.currentConnection = solver.failedConnection
    expect(solver.getAvailableExitPortPointsForOffboardConnection("left")).toEqual([])
    delete nodes[0]._offBoardConnectedCapacityMeshNodeIds
  }
})
