import { expect, test } from "bun:test"
import { CapacityMeshBoundaryEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshBoundaryEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("long strips use constant index storage per node and output-local candidates", () => {
  const nodes: CapacityMeshNode[] = Array.from({ length: 80 }, (_, i) => ({
    capacityMeshNodeId: `strip${i}`,
    center: { x: i / 2, y: 0 }, width: 0.5, height: 30,
    availableZ: [0, 1], layer: "top",
    _containsTarget: i % 11 === 0,
  }))
  const legacy = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
  const indexed = new CapacityMeshBoundaryEdgeSolver(nodes)
  legacy.solve()
  indexed.solve()
  expect(indexed.edges).toEqual(legacy.edges)
  expect(indexed.edges.length).toBe(79)
  expect(indexed.stats.boundaryEdges.indexItems).toBe(328)
  expect(indexed.stats.boundaryEdges.pairTests).toBeLessThan(80 * 8)
  expect(indexed.stats.boundaryEdges.boundaryQueries).toBe(320)
  expect(indexed.stats.boundaryEdges.phase).toBe("complete")
})
