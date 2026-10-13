import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

test("explicit disjoint pairs retain the original connection family routing order", (): void => {
  const aTopStart: PortPoint = {
    connectionName: "connection_a",
    rootConnectionName: "net_a",
    x: -0.4,
    y: -0.3,
    z: 0,
  }
  const aTopEnd: PortPoint = { ...aTopStart, x: 0.4 }
  const bStart: PortPoint = {
    connectionName: "connection_b",
    rootConnectionName: "net_b",
    x: 0.3,
    y: -0.1,
    z: 0,
  }
  const bEnd: PortPoint = { ...bStart, y: 0.1 }
  const aBottomStart: PortPoint = { ...aTopStart, y: 0.3, z: 1 }
  const aBottomEnd: PortPoint = { ...aBottomStart, x: 0.4 }
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "interleaved-pair-families",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    availableZ: [0, 1],
    useExplicitPortPointPairs: true,
    portPoints: [aTopStart, aTopEnd, bStart, bEnd, aBottomStart, aBottomEnd],
    portPointsInPairs: [
      [aTopStart, aTopEnd],
      [bStart, bEnd],
      [aBottomStart, aBottomEnd],
    ],
  }
  const originalNode = structuredClone(node)
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.1,
    viaDiameter: 0.3,
  })
  expect(solver.unsolvedConnections).toEqual([
    {
      connectionName: "connection_a",
      rootConnectionName: "net_a",
      points: [
        { x: -0.4, y: -0.3, z: 0 },
        { x: 0.4, y: -0.3, z: 0 },
      ],
    },
    {
      connectionName: "connection_a",
      rootConnectionName: "net_a",
      points: [
        { x: -0.4, y: 0.3, z: 1 },
        { x: 0.4, y: 0.3, z: 1 },
      ],
    },
    {
      connectionName: "connection_b",
      rootConnectionName: "net_b",
      points: [
        { x: 0.3, y: -0.1, z: 0 },
        { x: 0.3, y: 0.1, z: 0 },
      ],
    },
  ])
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.solvedRoutes).toHaveLength(3)
  expect(
    solver.solvedRoutes.map((route): string => route.connectionName),
  ).toEqual(["connection_b", "connection_a", "connection_a"])
  expect(
    solver.solvedRoutes.map((route): HighDensityRoute["vias"] => route.vias),
  ).toEqual([[], [], []])
  expect(
    solver.solvedRoutes.map(
      (route): (HighDensityRoute["route"][number] | undefined)[] => [
        route.route[0],
        route.route.at(-1),
      ],
    ),
  ).toEqual([
    [
      { x: 0.3, y: -0.1, z: 0 },
      { x: 0.3, y: 0.1, z: 0 },
    ],
    [
      { x: -0.4, y: 0.3, z: 1 },
      { x: 0.4, y: 0.3, z: 1 },
    ],
    [
      { x: -0.4, y: -0.3, z: 0 },
      { x: 0.4, y: -0.3, z: 0 },
    ],
  ])
  expect(node).toEqual(originalNode)
})
