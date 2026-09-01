import { expect, test } from "bun:test"
import {
  areNodePortPointPairsConnectedByRoutes,
  repairDisconnectedSameRootPortPoints,
} from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("repairs a same-root route whose endpoints are nearly coincident", (): void => {
  const fixedStart: PortPoint = {
    x: 0,
    y: 0,
    z: 0,
    connectionName: "breakout_fixed_0",
    rootConnectionName: "shared_net",
  }
  const fixedEnd: PortPoint = {
    x: 1,
    y: 0,
    z: 0,
    connectionName: "breakout_fixed_0",
    rootConnectionName: "shared_net",
  }
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "test_node",
    center: { x: 0.5, y: 0 },
    width: 2,
    height: 2,
    portPoints: [fixedStart, fixedEnd],
    portPointsInPairs: [[fixedStart, fixedEnd]],
  }
  const sharedNetRoute: HighDensityIntraNodeRoute = {
    connectionName: "routed_branch",
    rootConnectionName: "shared_net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
      { x: 1.0005, y: 0, z: 0 },
    ],
    vias: [],
  }

  const repairedRoutes = repairDisconnectedSameRootPortPoints(
    [sharedNetRoute],
    nodeWithPortPoints,
  )

  expect(repairedRoutes).toHaveLength(2)
  expect(repairedRoutes[1]).toMatchObject({
    connectionName: fixedStart.connectionName,
    rootConnectionName: fixedStart.rootConnectionName,
    route: [fixedStart, sharedNetRoute.route[1], fixedEnd],
  })
  expect(
    areNodePortPointPairsConnectedByRoutes(
      repairedRoutes,
      nodeWithPortPoints,
    ),
  ).toBeTrue()
})
