import { expect, test } from "bun:test"
import { getPhysicalPortObstacleReservations } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getPhysicalPortObstacleReservations"
import type { Obstacle } from "lib/types"

test("physical ports respect rotated pad clearance, net ownership and layers", (): void => {
  const pad: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.2,
    height: 1,
    ccwRotationDegrees: 90,
    layers: ["top"],
    connectedTo: ["net-a"],
  }
  const reservations = getPhysicalPortObstacleReservations(
    {
      topology: {
        portX: [0, 0.4, 1, 0, 2, 3],
        portY: [0, 0, 0, 0, 0, 0],
        portZ: [0, 0, 0, 1, 0, 0],
      },
      problem: {
        routeNet: [4, 5],
        routeMetadata: [
          { mutuallyConnectedNetworkId: "net-a" },
          { mutuallyConnectedNetworkId: "net-b" },
        ],
      },
    },
    {
      traceWidth: 0.1,
      clearance: 0.1,
      obstacles: [
        pad,
        { ...pad, center: { x: 2, y: 0 }, connectedTo: [] },
        { ...pad, center: { x: 3, y: 0 } },
        { ...pad, center: { x: 3, y: 0 }, connectedTo: ["net-b"] },
      ],
    },
    2,
  )
  expect([...reservations]).toEqual([4, 4, -1, -1, -2, -2])
})
