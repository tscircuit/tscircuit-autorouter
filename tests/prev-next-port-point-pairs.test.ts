import { expect, test } from "bun:test"
import { IntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/IntraNodeSolverWithJumpers"
import { SingleLayerNoDifferentRootIntersectionsIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleLayerNoDifferentRootIntersectionsIntraNodeSolver"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { SingleTransitionThroughObstacleIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionThroughObstacleIntraNodeSolver"
import type { Obstacle } from "lib/types"
import type {
  HighDensityIntraNodeRoute,
  HighDensityIntraNodeRouteWithJumpers,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"

const getPortPointIds = (pairs: Array<[PortPoint, PortPoint]>) =>
  pairs.map(([A, B]) => [A.portPointId, B.portPointId])

const getSolvedRouteEndpoints = (
  routes: Array<
    HighDensityIntraNodeRoute | HighDensityIntraNodeRouteWithJumpers
  >,
) =>
  routes
    .map((route) => {
      const start = route.route[0]!
      const end = route.route[route.route.length - 1]!
      return [`${start.x},${start.y},${start.z}`, `${end.x},${end.y},${end.z}`]
        .sort()
        .join("|")
    })
    .sort()

const transitionPortPoints: PortPoint[] = [
  {
    portPointId: "p1",
    connectionName: "chain",
    x: 1,
    y: 1,
    z: 0,
    nextPortPointId: "p2",
  },
  {
    portPointId: "p2",
    connectionName: "chain",
    x: 1.5,
    y: 1,
    z: 1,
    prevPortPointId: "p1",
  },
  {
    portPointId: "p3",
    connectionName: "chain",
    x: 3.5,
    y: 4,
    z: 0,
    nextPortPointId: "p4",
  },
  {
    portPointId: "p4",
    connectionName: "chain",
    x: 4,
    y: 4,
    z: 1,
    prevPortPointId: "p3",
  },
]

const transitionNode: NodeWithPortPoints = {
  capacityMeshNodeId: "transition-node",
  center: { x: 2.5, y: 2.5 },
  width: 5,
  height: 5,
  portPoints: transitionPortPoints,
}

const throughObstacle: Obstacle = {
  type: "rect",
  center: { x: 2.5, y: 2.5 },
  width: 5,
  height: 5,
  layers: ["top", "bottom"],
  connectedTo: ["chain"],
}

const singleLayerNode: NodeWithPortPoints = {
  capacityMeshNodeId: "single-layer-node",
  center: { x: 2.5, y: 2.5 },
  width: 5,
  height: 5,
  availableZ: [0],
  portPoints: [
    {
      portPointId: "a",
      connectionName: "chain",
      x: 0,
      y: 1,
      z: 0,
      nextPortPointId: "b",
    },
    {
      portPointId: "b",
      connectionName: "chain",
      x: 5,
      y: 1,
      z: 0,
      prevPortPointId: "a",
    },
    {
      portPointId: "c",
      connectionName: "chain",
      x: 0,
      y: 4,
      z: 0,
      nextPortPointId: "d",
    },
    {
      portPointId: "d",
      connectionName: "chain",
      x: 5,
      y: 4,
      z: 0,
      prevPortPointId: "c",
    },
  ],
}

const jumperNode: NodeWithPortPoints = {
  capacityMeshNodeId: "jumper-node",
  center: { x: 2.5, y: 2.5 },
  width: 5,
  height: 5,
  portPoints: [
    {
      portPointId: "j1",
      connectionName: "chain",
      x: 0.5,
      y: 1,
      z: 0,
      nextPortPointId: "j2",
    },
    {
      portPointId: "j2",
      connectionName: "chain",
      x: 4.5,
      y: 1,
      z: 0,
      prevPortPointId: "j1",
    },
    {
      portPointId: "j3",
      connectionName: "chain",
      x: 0.5,
      y: 4,
      z: 0,
      nextPortPointId: "j4",
    },
    {
      portPointId: "j4",
      connectionName: "chain",
      x: 4.5,
      y: 4,
      z: 0,
      prevPortPointId: "j3",
    },
  ],
}

test("getConnectionPortPointPairs uses prev/next links before connectionName grouping", () => {
  expect(
    getPortPointIds(getConnectionPortPointPairs(transitionPortPoints)),
  ).toEqual([
    ["p1", "p2"],
    ["p3", "p4"],
  ])
})

test("SingleTransitionIntraNodeSolver extracts one route per linked pair", () => {
  const solver = new SingleTransitionIntraNodeSolver({
    nodeWithPortPoints: transitionNode,
  })

  expect(getPortPointIds(solver.routes.map(({ A, B }) => [A, B]))).toEqual([
    ["p1", "p2"],
    ["p3", "p4"],
  ])
  expect(solver.failed).toBe(true)
  expect(String(solver.error)).toContain("Expected 1 route, but got 2")
})

test("SingleTransitionThroughObstacleIntraNodeSolver solves one route per linked pair", () => {
  const solver = new SingleTransitionThroughObstacleIntraNodeSolver({
    nodeWithPortPoints: transitionNode,
    obstacles: [throughObstacle],
    layerCount: 2,
  })

  expect(solver.solved).toBe(true)
  expect(getSolvedRouteEndpoints(solver.solvedRoutes)).toEqual([
    "1,1,0|1.5,1,1",
    "3.5,4,0|4,4,1",
  ])
})

test("SingleLayerNoDifferentRootIntersectionsIntraNodeSolver routes the explicit linked pairs", () => {
  const solver = new SingleLayerNoDifferentRootIntersectionsIntraNodeSolver({
    nodeWithPortPoints: singleLayerNode,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(getSolvedRouteEndpoints(solver.solvedRoutes)).toEqual([
    "0,1,0|5,1,0",
    "0,4,0|5,4,0",
  ])
})

test("IntraNodeSolverWithJumpers builds separate route tasks for linked pairs", () => {
  const solver = new IntraNodeSolverWithJumpers({
    nodeWithPortPoints: jumperNode,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(getSolvedRouteEndpoints(solver.solvedRoutes)).toEqual([
    "0.5,1,0|4.5,1,0",
    "0.5,4,0|4.5,4,0",
  ])
})
