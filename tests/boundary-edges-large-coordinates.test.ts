import { expect, test } from "bun:test"
import { CapacityMeshBoundaryEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshBoundaryEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("outward side broadphase preserves large-coordinate rounding and colliding legacy keys", () => {
  for (const center of [-1e12, -1e6, 0, 1e6, 1e12]) {
    for (const gap of [0, 0.0005, 0.000999999999, 0.001, 0.001000000001]) {
      const nodes: CapacityMeshNode[] = [
        { capacityMeshNodeId: "a-b", center: { x: center, y: 0 }, width: 1, height: 1, layer: "top", availableZ: [0] },
        { capacityMeshNodeId: "c", center: { x: center + 1 + gap, y: 0 }, width: 1, height: 1, layer: "top", availableZ: [0] },
        { capacityMeshNodeId: "a", center: { x: center, y: 3 }, width: 1, height: 1, layer: "top", availableZ: [0] },
        { capacityMeshNodeId: "b-c", center: { x: center + 1 + gap, y: 3 }, width: 1, height: 1, layer: "top", availableZ: [0] },
        { capacityMeshNodeId: "tiny", center: { x: center + 0.5001, y: 0 }, width: 0.00001, height: 0.01, layer: "top", availableZ: [0] },
      ]
      const legacy = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
      const indexed = new CapacityMeshBoundaryEdgeSolver(nodes)
      legacy.solve()
      indexed.solve()
      expect(indexed.edges).toEqual(legacy.edges)
      if (gap === 0) expect(indexed.hasEdgeBetween(nodes[2]!, nodes[3]!)).toBe(legacy.hasEdgeBetween(nodes[2]!, nodes[3]!))
    }
  }
})
