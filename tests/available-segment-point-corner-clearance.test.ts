import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshEdge, CapacityMeshNode, Obstacle } from "lib/types"

const nodes: CapacityMeshNode[] = [
  {
    capacityMeshNodeId: "lower",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [0, 1],
  },
  {
    capacityMeshNodeId: "upper",
    center: { x: 0, y: 2 },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [0, 1],
  },
]

const edges: CapacityMeshEdge[] = [
  {
    capacityMeshEdgeId: "shared_edge",
    nodeIds: ["lower", "upper"],
  },
]

test("boundary ports preserve detailed-router corner clearance", () => {
  const traceWidth = 0.1
  const obstacleMargin = 0.15
  const requiredCornerClearance = traceWidth / 2 + obstacleMargin
  const obstacle: Obstacle = {
    obstacleId: "left_pad",
    type: "rect",
    layers: ["top"],
    __zLayers: [0],
    center: { x: -1.1, y: 1 },
    width: 0.2,
    height: 0.2,
    connectedTo: [],
  }
  const solver = new AvailableSegmentPointSolver({
    nodes,
    edges,
    traceWidth,
    obstacleMargin,
    obstacles: [obstacle],
    shouldReturnCrampedPortPoints: false,
  })
  solver.solve()

  const portPoints = solver.getOutput()[0]!.portPoints
  const topStart = portPoints.find(
    (point) => point.segmentPortPointId === "shared_edge_pp0_z0",
  )!
  const innerStart = portPoints.find(
    (point) => point.segmentPortPointId === "shared_edge_pp0_z1",
  )!

  expect(topStart.x).toBeCloseTo(-1 + requiredCornerClearance, 10)
  expect(innerStart.x).toBeCloseTo(-1 + (0.25 * 3) / 4, 10)
  expect(portPoints).toHaveLength(12)
})
