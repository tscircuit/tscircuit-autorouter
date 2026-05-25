import { createPortPointPairsFromPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"
import { test, expect } from "bun:test"
import { IntraNodeSolverWithJumpers } from "lib/solvers/HighDensitySolver/IntraNodeSolverWithJumpers"
import { SingleHighDensityRouteWithJumpersSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteWithJumpersSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
test("SingleHighDensityRouteWithJumpersSolver - simple route without obstacles", () => {
  const solver = new SingleHighDensityRouteWithJumpersSolver({
    connectionName: "test-connection",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.5,
    bounds: { minX: 0, maxX: 5, minY: 0, maxY: 5 },
    A: { x: 0.5, y: 2.5, z: 0 },
    B: { x: 4.5, y: 2.5, z: 0 },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.solvedPath).not.toBeNull()
  expect(solver.solvedPath!.jumpers.length).toBe(0) // No jumpers needed
  expect(solver.solvedPath!.route.length).toBeGreaterThan(0)
})
test("IntraNodeSolverWithJumpers - simple node routing", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 2.5, y: 2.5 },
    width: 5,
    height: 5,
    portPointsInPairs: createPortPointPairsFromPortPoints([
      { connectionName: "conn1", x: 0.5, y: 2.5, z: 0 },
      { connectionName: "conn1", x: 4.5, y: 2.5, z: 0 },
    ]),
  }
  const solver = new IntraNodeSolverWithJumpers({
    nodeWithPortPoints,
    colorMap: { conn1: "blue" },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(1)
  expect(solver.solvedRoutes[0].connectionName).toBe("conn1")
})
test("IntraNodeSolverWithJumpers - multiple connections", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 2.5, y: 2.5 },
    width: 5,
    height: 5,
    portPointsInPairs: createPortPointPairsFromPortPoints([
      // Connection 1: horizontal
      { connectionName: "conn1", x: 0.5, y: 1, z: 0 },
      { connectionName: "conn1", x: 4.5, y: 1, z: 0 },
      // Connection 2: also horizontal, above conn1
      { connectionName: "conn2", x: 0.5, y: 4, z: 0 },
      { connectionName: "conn2", x: 4.5, y: 4, z: 0 },
    ]),
  }
  const solver = new IntraNodeSolverWithJumpers({
    nodeWithPortPoints,
    colorMap: { conn1: "blue", conn2: "red" },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes.length).toBe(2)
})
test("IntraNodeSolverWithJumpers - visualize() includes jumper pads", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 2.5, y: 2.5 },
    width: 5,
    height: 5,
    portPointsInPairs: createPortPointPairsFromPortPoints([
      { connectionName: "conn1", x: 0.5, y: 2.5, z: 0 },
      { connectionName: "conn1", x: 4.5, y: 2.5, z: 0 },
    ]),
  }
  const solver = new IntraNodeSolverWithJumpers({
    nodeWithPortPoints,
    colorMap: { conn1: "blue" },
  })
  solver.solve()
  const graphics = solver.visualize()
  // Should have visualization data
  expect(graphics.points).toBeDefined()
  expect(graphics.lines).toBeDefined()
  expect(graphics.rects).toBeDefined()
  // Should have port points visualized
  expect(graphics.points!.length).toBeGreaterThan(0)
  // Should have route lines visualized
  expect(graphics.lines!.length).toBeGreaterThan(0)
})
test("IntraNodeSolverWithJumpers - forces single layer (z=0)", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node1",
    center: { x: 2.5, y: 2.5 },
    width: 5,
    height: 5,
    portPointsInPairs: createPortPointPairsFromPortPoints([
      // Even if z=1 is specified, it should be forced to z=0
      { connectionName: "conn1", x: 0.5, y: 2.5, z: 1 },
      { connectionName: "conn1", x: 4.5, y: 2.5, z: 0 },
    ]),
  }
  const solver = new IntraNodeSolverWithJumpers({
    nodeWithPortPoints,
    colorMap: { conn1: "blue" },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  // All route points should be on layer 0
  for (const route of solver.solvedRoutes) {
    for (const point of route.route) {
      expect(point.z).toBe(0)
    }
  }
})
