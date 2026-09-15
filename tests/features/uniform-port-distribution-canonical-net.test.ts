import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getReservedCoordinateIntervals } from "lib/solvers/UniformPortDistributionSolver/getReservedCoordinateIntervals"
import type {
  OwnerPairKey,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("does not reserve a shared edge against same-net copper by its canonical ID", () => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["source-net", "source-net-branch"]])
  const canonicalNetId = connMap.getNetConnectedToId("source-net")
  if (!canonicalNetId) throw new Error("Expected a canonical net ID")

  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["north", "south"],
    ownerPairKey: "north|south" as OwnerPairKey,
    orientation: "horizontal",
    x1: 0,
    y1: 0,
    x2: 2,
    y2: 0,
    center: { x: 1, y: 0 },
    length: 2,
    nodeSideByOwnerId: { north: "bottom", south: "top" },
  }
  const reservedIntervals = getReservedCoordinateIntervals({
    sharedEdge,
    targetPortPoint: {
      portPointId: "target-port",
      connectionName: "source-net-branch",
      rootConnectionName: "source-net",
      x: 1,
      y: 0,
      z: 0,
    },
    allPortPoints: [],
    fixedPortPointIds: new Set(),
    copperKeepouts: [
      {
        keepoutId: "same-net-wire",
        shape: "capsule",
        start: { x: 0, y: 0 },
        end: { x: 2, y: 0 },
        copperRadius: 0.1,
        z: 0,
        connectedTo: [canonicalNetId],
        portPathingReservation: "full-edge",
      },
    ],
    minTraceWidth: 0.1,
    traceClearance: 0.15,
    connMap,
  })

  expect(reservedIntervals).toEqual([])
})
