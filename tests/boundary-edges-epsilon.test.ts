import { expect, test } from "bun:test"
import { CapacityMeshBoundaryEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshBoundaryEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("surface queries preserve strict epsilon, inclusive overlap, tiny bucket and layer semantics", () => {
  for (const shift of [-1.2, -0.4, -0.0001, 0, 0.4, 1.2]) {
    for (const gap of [-0.0010000001, -0.001, -0.0009999999, 0, 0.0009999999, 0.001, 0.0010000001]) {
      for (const overlap of [0, 0.0009999999, 0.001, 0.0010000001, 0.002]) {
        const nodes: CapacityMeshNode[] = [
          { capacityMeshNodeId: "a", center: { x: shift, y: 0 }, width: 0.0002, height: 0.002, layer: "top", availableZ: [0] },
          { capacityMeshNodeId: "b", center: { x: shift + 0.0002 + gap, y: 0.002 - overlap }, width: 0.0002, height: 0.002, layer: "top", availableZ: [0, 3] },
          { capacityMeshNodeId: "c", center: { x: shift, y: 0.002 }, width: 0.0002, height: 0.002, layer: "inner1", availableZ: [1] },
        ]
        const legacy = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
        const indexed = new CapacityMeshBoundaryEdgeSolver(nodes)
        legacy.solve()
        indexed.solve()
        expect(indexed.edges).toEqual(legacy.edges)
      }
    }
  }
  const empty = new CapacityMeshBoundaryEdgeSolver([])
  empty.solve()
  expect(empty.edges).toEqual([])
  expect(empty.solved).toBe(true)
})
