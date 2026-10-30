import { expect, test } from "bun:test"
import { CapacityMeshBoundaryEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshBoundaryEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("surface index preserves the complete ordered legacy graph across randomized meshes", () => {
  let seed = 739124
  for (let trial = 0; trial < 350; trial++) {
    const nodes: CapacityMeshNode[] = []
    for (let i = 0; i < 45; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const x = (seed % 17) / 2 - 4
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const y = (seed % 17) / 2 - 4
      const width = [0.001, 0.25, 0.5, 1, 2][(seed >>> 9) % 5]!
      const height = [0.001, 0.5, 1, 1.5][(seed >>> 17) % 4]!
      nodes.push({
        capacityMeshNodeId: `n-${trial}-${i}`,
        center: { x, y }, width, height, layer: "top",
        availableZ: (seed & 1) ? [0, 2] : [1, 2],
        _containsTarget: (seed % 7) === 0,
        _strawNode: (seed % 3) === 0,
        _strawParentCapacityMeshNodeId: `parent-${seed % 4}`,
      })
    }
    const before = JSON.stringify(nodes)
    const legacy = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
    const indexed = new CapacityMeshBoundaryEdgeSolver(nodes)
    legacy.solve()
    indexed.solve()
    expect(indexed.edges).toEqual(legacy.edges)
    expect(indexed.iterations).toBe(legacy.iterations)
    expect(indexed.failed).toBe(false)
    expect(JSON.stringify(nodes)).toBe(before)
  }
})
