import { expect, test } from "bun:test"
import { repairDisconnectedSameRootPortPoints } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("same-root repair omits an absent jumper list from copied routes", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "cmn_repair",
    center: { x: 1, y: 0 },
    width: 2,
    height: 1,
    portPoints: [
      {
        connectionName: "a",
        rootConnectionName: "root",
        x: 0,
        y: 0,
        z: 0,
      },
      {
        connectionName: "a",
        rootConnectionName: "root",
        x: 2,
        y: 0,
        z: 0,
      },
    ],
  }
  const bridgeRoute: HighDensityIntraNodeRoute = {
    connectionName: "b",
    rootConnectionName: "root",
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
  expect(repairedRoutes[1]?.connectionName).toBe("a")
  expect(Object.hasOwn(repairedRoutes[1]!, "jumpers")).toBe(false)
})
