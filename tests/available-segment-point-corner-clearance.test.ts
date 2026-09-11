import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshEdge, CapacityMeshNode } from "lib/types"

const nodes: CapacityMeshNode[] = [
  {
    capacityMeshNodeId: "lower",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [1],
  },
  {
    capacityMeshNodeId: "upper",
    center: { x: 0, y: 2 },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [1],
  },
]

const edges: CapacityMeshEdge[] = [
  {
    capacityMeshEdgeId: "shared-edge",
    nodeIds: ["lower", "upper"],
  },
]

test("boundary ports preserve detailed-router corner clearance", () => {
  const traceWidth = 0.1
  const obstacleMargin = 0.15
  const requiredCornerClearance = traceWidth / 2 + obstacleMargin
  const solver = new AvailableSegmentPointSolver({
    nodes,
    edges,
    traceWidth,
    obstacleMargin,
    minimumPortDistanceFromEdgeEndpoint: requiredCornerClearance,
    shouldReturnCrampedPortPoints: false,
  })
  solver.solve()

  const portPoints = solver
    .getOutput()[0]!
    .portPoints.toSorted((pointA, pointB) => pointA.x - pointB.x)

  expect(portPoints[0]!.x).toBeCloseTo(-1 + requiredCornerClearance, 10)
  expect(portPoints.at(-1)!.x).toBeCloseTo(1 - requiredCornerClearance, 10)
})
