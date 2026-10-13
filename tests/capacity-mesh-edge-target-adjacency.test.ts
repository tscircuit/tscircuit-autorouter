import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("capacity mesh target validation uses existing routing adjacency", () => {
  const createNode = (
    capacityMeshNodeId: string,
    x: number,
    targetConnectionName?: string,
  ): CapacityMeshNode => ({
    capacityMeshNodeId,
    center: { x, y: 0 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
    _containsTarget: targetConnectionName ? true : undefined,
    _containsObstacle: targetConnectionName ? true : undefined,
    _targetConnectionName: targetConnectionName,
  })
  const solver = new CapacityMeshEdgeSolver2_NodeTreeOptimization([
    createNode("target-a", 0, "connection-a"),
    createNode("target-b", 1, "connection-b"),
    createNode("routing-left", -1),
    createNode("routing-right", 2),
  ])

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.edges).toHaveLength(3)
})
