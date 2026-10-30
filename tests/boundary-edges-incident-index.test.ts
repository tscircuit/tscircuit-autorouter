import { expect, test } from "bun:test"
import { CapacityMeshBoundaryEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshBoundaryEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("sparse targets query local rectangles and validate only their incident routing nodes", () => {
  const nodes: CapacityMeshNode[] = []
  for (let i = 0; i < 300; i++) {
    nodes.push({ capacityMeshNodeId: `pad${i}`, center: { x: i * 3, y: 0 }, width: 1, height: 1, layer: "top", availableZ: [0, 1], _containsTarget: true, _containsObstacle: true, _targetConnectionName: `net${i}` })
    nodes.push({ capacityMeshNodeId: `space${i}`, center: { x: i * 3 + 1, y: 0 }, width: 1, height: 1, layer: "top", availableZ: [0] })
  }
  const before = JSON.stringify(nodes)
  const legacy = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
  const indexed = new CapacityMeshBoundaryEdgeSolver(nodes)
  legacy.solve()
  indexed.solve()
  expect(indexed.edges).toEqual(legacy.edges)
  expect(indexed.edges.length).toBe(300)
  expect(indexed.stats.boundaryEdges.targetQueries).toBe(300)
  expect(indexed.stats.boundaryEdges.targetHits).toBe(0)
  expect(indexed.stats.boundaryEdges.incidentVisits).toBe(300)
  expect(JSON.stringify(nodes)).toBe(before)
})
