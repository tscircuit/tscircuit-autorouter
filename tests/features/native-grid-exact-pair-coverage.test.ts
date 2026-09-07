import { expect, test } from "bun:test"
import { doRoutesCoverNodePortPointPairsExactlyOnce } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("native grid coverage matches exact endpoints and their net exactly once", () => {
  const start: PortPoint = {
    connectionName: "net-a",
    rootConnectionName: "root-a",
    x: -1,
    y: 0,
    z: 0,
  }
  const end: PortPoint = { ...start, x: 1 }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: [start, end],
  }
  const route: HighDensityIntraNodeRoute = {
    connectionName: "net-a",
    rootConnectionName: "root-a",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [start, end],
    vias: [],
  }
  const otherNetRoute = {
    ...route,
    connectionName: "net-b",
    rootConnectionName: "root-b",
  }
  const twoNetNode = {
    ...node,
    portPoints: [
      ...node.portPoints,
      ...node.portPoints.map((point) => ({
        ...point,
        connectionName: "net-b",
        rootConnectionName: "root-b",
      })),
    ],
  }

  expect({
    valid: doRoutesCoverNodePortPointPairsExactlyOnce([route], node),
    reversed: doRoutesCoverNodePortPointPairsExactlyOnce(
      [{ ...route, route: [end, start] }],
      node,
    ),
    wrongConnection: doRoutesCoverNodePortPointPairsExactlyOnce(
      [{ ...route, connectionName: "net-b" }],
      node,
    ),
    wrongRoot: doRoutesCoverNodePortPointPairsExactlyOnce(
      [{ ...route, rootConnectionName: "root-b" }],
      node,
    ),
    shiftedEndpoint: doRoutesCoverNodePortPointPairsExactlyOnce(
      [{ ...route, route: [{ ...start, x: start.x + 1e-7 }, end] }],
      node,
    ),
    missing: doRoutesCoverNodePortPointPairsExactlyOnce([], node),
    duplicate: doRoutesCoverNodePortPointPairsExactlyOnce([route, route], node),
    missingCoincidentNet: doRoutesCoverNodePortPointPairsExactlyOnce(
      [route],
      twoNetNode,
    ),
    bothCoincidentNets: doRoutesCoverNodePortPointPairsExactlyOnce(
      [route, otherNetRoute],
      twoNetNode,
    ),
    explicitPairs: doRoutesCoverNodePortPointPairsExactlyOnce([route], {
      ...twoNetNode,
      portPointsInPairs: [[start, end]],
    }),
  }).toEqual({
    valid: true,
    reversed: true,
    wrongConnection: false,
    wrongRoot: false,
    shiftedEndpoint: false,
    missing: false,
    duplicate: false,
    missingCoincidentNet: false,
    bothCoincidentNets: true,
    explicitPairs: true,
  })
})
