import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import type { CapacityMeshNode } from "lib/types"

test("a target partition reaches free space through its connected target neighbor", () => {
  const nodes: CapacityMeshNode[] = [0, 1, 2].map((x) => ({
    capacityMeshNodeId: `region_${x}`,
    center: { x, y: 0 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
    _containsObstacle: x < 2,
    _containsTarget: x < 2,
    _targetConnectionName: x < 2 ? "clock_tap" : undefined,
  }))
  const solver = new CapacityMeshEdgeSolver(nodes)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.edges.map((edge) => edge.nodeIds)).toEqual([
    ["region_0", "region_1"],
    ["region_1", "region_2"],
  ])
})
