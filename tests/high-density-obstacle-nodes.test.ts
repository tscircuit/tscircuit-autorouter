import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { PortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"

test("PortPointPathingSolver preserves obstacle metadata on solved nodes", () => {
  const solver = new PortPointPathingSolver({
    simpleRouteJson: {
      connections: [],
    } as any,
    capacityMeshNodes: [
      {
        capacityMeshNodeId: "cmn_obstacle",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        availableZ: [0],
      } as any,
    ],
    inputNodes: [
      {
        capacityMeshNodeId: "cmn_obstacle",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        portPoints: [],
        availableZ: [0],
        _containsObstacle: true,
      },
    ],
  })

  solver.nodeAssignedPortPoints.set("cmn_obstacle", [
    {
      portPointId: "pp1",
      x: 0,
      y: 0.5,
      z: 0,
      connectionName: "conn1",
    },
  ])

  expect(solver.getNodesWithPortPoints()).toEqual([
    {
      capacityMeshNodeId: "cmn_obstacle",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      portPoints: [
        {
          portPointId: "pp1",
          x: 0,
          y: 0.5,
          z: 0,
          connectionName: "conn1",
        },
      ],
      availableZ: [0],
      _containsObstacle: true,
      _containsTarget: undefined,
    },
  ])
})

test("HighDensitySolver skips obstacle nodes", () => {
  const solver = new HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cmn_obstacle",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        portPoints: [
          {
            x: -0.5,
            y: 0,
            z: 0,
            connectionName: "blocked",
          },
          {
            x: 0.5,
            y: 0,
            z: 0,
            connectionName: "blocked",
          },
        ],
        _containsObstacle: true,
      },
      {
        capacityMeshNodeId: "cmn_routable",
        center: { x: 0, y: 0 },
        width: 1,
        height: 1,
        portPoints: [
          {
            x: -0.5,
            y: 0,
            z: 0,
            connectionName: "conn1",
          },
          {
            x: 0.5,
            y: 0,
            z: 0,
            connectionName: "conn1",
          },
        ],
      },
    ],
    colorMap: {
      blocked: "hsl(0, 100%, 50%)",
      conn1: "hsl(120, 100%, 50%)",
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.nodeSolveMetadataById.has("cmn_obstacle")).toBe(false)
  expect(solver.nodeSolveMetadataById.has("cmn_routable")).toBe(true)
})
