import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("overlapping target regions can still share a routing exit", (): void => {
  for (const Solver of [
    CapacityMeshEdgeSolver,
    CapacityMeshEdgeSolver2_NodeTreeOptimization,
  ]) {
    const nodes: CapacityMeshNode[] = [
      { x: 0, y: 0 },
      { x: 0.75, y: 0.5 },
      { x: 1.75, y: 0.5 },
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
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(
      solver.edges.some(
        (edge) =>
          edge.nodeIds.includes("region_0") &&
          edge.nodeIds.includes("region_1"),
      ),
    ).toBe(true)
  }
})
