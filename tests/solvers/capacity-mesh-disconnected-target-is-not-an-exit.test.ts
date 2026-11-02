import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import type { CapacityMeshNode } from "lib/types"

test("a disconnected region on the same connection still needs its own exit", () => {
  const nodes: CapacityMeshNode[] = [0, 10, 11].map((x) => ({
    capacityMeshNodeId: `region_${x}`,
    center: { x, y: 0 },
    width: 1,
    height: 1,
    layer: "z0",
    availableZ: [0],
    _containsObstacle: x !== 11,
    _containsTarget: x !== 11,
    _targetConnectionName: x !== 11 ? "clock_tap" : undefined,
  }))
  const solver = new CapacityMeshEdgeSolver(nodes)
  expect(() => solver.solve()).toThrow("no bordering routing edge")
  expect(solver.failed).toBe(true)
})
