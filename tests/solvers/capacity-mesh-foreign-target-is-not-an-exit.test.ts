import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import type { CapacityMeshNode } from "lib/types"

test("a foreign target cannot provide the missing free-space exit", () => {
  const nodes: CapacityMeshNode[] = [0, 1, 2].map((x) => ({
    capacityMeshNodeId: `region_${x}`,
    center: { x, y: 0 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
    _containsObstacle: x < 2,
    _containsTarget: x < 2,
    _targetConnectionName: ["clock_tap", "foreign_signal", undefined][x],
  }))
  const solver = new CapacityMeshEdgeSolver(nodes)
  expect(() => solver.solve()).toThrow("no bordering routing edge")
  expect(solver.failed).toBe(true)
})
