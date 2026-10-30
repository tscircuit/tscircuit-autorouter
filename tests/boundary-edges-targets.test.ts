import { expect, test } from "bun:test"
import { CapacityMeshBoundaryEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshBoundaryEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode } from "lib/types"

test("indexed target overlap and incident validation preserve edge order and named failure", () => {
  const nodes: CapacityMeshNode[] = [
    { capacityMeshNodeId: "a-b", center: { x: 0, y: 0 }, width: 1, height: 1, layer: "top", availableZ: [0], _containsTarget: true, _strawNode: true, _strawParentCapacityMeshNodeId: "p" },
    { capacityMeshNodeId: "c", center: { x: 1, y: 0 }, width: 1, height: 1, layer: "top", availableZ: [0], _containsTarget: true, _strawNode: true, _strawParentCapacityMeshNodeId: "p" },
    { capacityMeshNodeId: "a", center: { x: 0.25, y: 0.25 }, width: 0.2, height: 0.2, layer: "top", availableZ: [0], _containsTarget: true },
    { capacityMeshNodeId: "b-c", center: { x: 0.45, y: 0.25 }, width: 0.2, height: 0.2, layer: "top", availableZ: [0], _containsTarget: true },
    { capacityMeshNodeId: "touch", center: { x: 1.5005, y: 0.5005 }, width: 0.001, height: 0.001, layer: "top", availableZ: [0], _containsTarget: true },
  ]
  for (const targetObstacle of [false, true]) {
    const input = structuredClone(nodes)
    input[0]!._containsObstacle = targetObstacle
    input[0]!._targetConnectionName = "signal"
    const legacy = new CapacityMeshEdgeSolver2_NodeTreeOptimization(input)
    const indexed = new CapacityMeshBoundaryEdgeSolver(input)
    let legacyError: unknown
    let indexedError: unknown
    try { legacy.solve() } catch (error) { legacyError = (error as Error).message }
    try { indexed.solve() } catch (error) { indexedError = (error as Error).message }
    expect(indexedError).toEqual(legacyError)
    expect(indexed.edges).toEqual(legacy.edges)
    expect(indexed.stats.boundaryEdges.targetEdges).toBeGreaterThan(0)
  }
  const duplicate = [...nodes, structuredClone(nodes[0]!)]
  expect(() => new CapacityMeshBoundaryEdgeSolver(duplicate)).toThrow("unique node IDs")
})
