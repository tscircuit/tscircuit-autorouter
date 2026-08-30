import { expect, test } from "bun:test"
import { repairDisconnectedSameRootPortPoints } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("same-root repair canonicalizes rootless MST connection names", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "rootless-mst-repair",
    center: { x: 1, y: 0 },
    width: 3,
    height: 1,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "net_mst0", x: 0, y: 0, z: 0 },
      { connectionName: "net_mst0", x: 2, y: 0, z: 0 },
    ],
  }
  const bridgeRoute: HighDensityIntraNodeRoute = {
    connectionName: "net_mst1",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }

  const repairedRoutes = repairDisconnectedSameRootPortPoints(
    [bridgeRoute],
    node,
  )

  expect(repairedRoutes).toHaveLength(2)
  expect(repairedRoutes[1]).toMatchObject({
    connectionName: "net_mst0",
    rootConnectionName: "net",
  })
})
