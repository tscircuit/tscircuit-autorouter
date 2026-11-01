import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("a corner contact cannot connect a target to its neighbor's routing exit", (): void => {
  for (const Solver of [
    CapacityMeshEdgeSolver,
    CapacityMeshEdgeSolver2_NodeTreeOptimization,
  ]) {
    for (const [x, y] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      // Unit squares in board mm. The first two touch at one corner;
      // only the second target shares a border with the free region.
      const nodes: CapacityMeshNode[] = [
        { x: 0, y: 0 },
        { x, y },
        { x: 2 * x, y },
      ].map(
        (center, index): CapacityMeshNode => ({
          capacityMeshNodeId: `region_${index}`,
          center,
          width: 1,
          height: 1,
          layer: "z0",
          availableZ: [0],
          _containsObstacle: index < 2,
          _containsTarget: index < 2,
          _targetConnectionName: index < 2 ? "clock_tap" : undefined,
        }),
      )
      const solver = new Solver(nodes)
      expect(() => solver.solve()).toThrow("no bordering routing edge")
      expect(solver.failed).toBe(true)
      expect(
        solver.edges.some(
          (edge) =>
            edge.nodeIds.includes("region_0") &&
            edge.nodeIds.includes("region_1"),
        ),
      ).toBe(false)
    }
  }
})
