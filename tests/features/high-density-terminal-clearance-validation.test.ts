import { expect, test } from "bun:test"
import { getHighDensityIntraNodeRouteValidationError } from "lib/solvers/HighDensitySolver/validate-high-density-intra-node-routes"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("validation only permits trusted terminal-clearance escape stubs", () => {
  const terminalA: PortPoint = {
    connectionName: "a",
    rootConnectionName: "a",
    portPointId: "terminal-a",
    x: 0,
    y: 0,
    z: 0,
  }
  const terminalB: PortPoint = {
    connectionName: "b",
    rootConnectionName: "b",
    portPointId: "terminal-b",
    x: 0.117,
    y: 0,
    z: 0,
  }
  const endA: PortPoint = {
    ...terminalA,
    portPointId: "end-a",
    x: -1,
    y: 1,
  }
  const endB: PortPoint = {
    ...terminalB,
    portPointId: "end-b",
    x: 1,
    y: 1,
  }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "terminal-clearance-node",
    center: { x: 0, y: 0.5 },
    width: 3,
    height: 2,
    availableZ: [0, 1],
    portPoints: [terminalA, endA, terminalB, endB],
    portPointsInPairs: [
      [terminalA, endA],
      [terminalB, endB],
    ],
  }
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "a",
      rootConnectionName: "a",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [terminalA, endA],
      vias: [],
    },
    {
      connectionName: "b",
      rootConnectionName: "b",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [terminalB, endB],
      vias: [],
    },
  ]

  expect(
    getHighDensityIntraNodeRouteValidationError({
      routes,
      nodeWithPortPoints: node,
      requirePairConnectivity: true,
    }),
  ).toBeUndefined()

  const missingTerminalIdentityRoutes = structuredClone(routes)
  delete (missingTerminalIdentityRoutes[0]!.route[0] as any).portPointId
  expect(
    getHighDensityIntraNodeRouteValidationError({
      routes: missingTerminalIdentityRoutes,
      nodeWithPortPoints: node,
      requirePairConnectivity: true,
    }),
  ).toContain("route geometry violations")

  const convergingRoutes = structuredClone(routes)
  convergingRoutes[0]!.route[1] = { ...endA, x: 0.04 }
  convergingRoutes[1]!.route[1] = { ...endB, x: 0.08 }
  expect(
    getHighDensityIntraNodeRouteValidationError({
      routes: convergingRoutes,
      nodeWithPortPoints: {
        ...node,
        portPoints: [
          terminalA,
          convergingRoutes[0]!.route[1] as PortPoint,
          terminalB,
          convergingRoutes[1]!.route[1] as PortPoint,
        ],
        portPointsInPairs: [
          [terminalA, convergingRoutes[0]!.route[1] as PortPoint],
          [terminalB, convergingRoutes[1]!.route[1] as PortPoint],
        ],
      },
      requirePairConnectivity: true,
    }),
  ).toContain("route geometry violations")
})
