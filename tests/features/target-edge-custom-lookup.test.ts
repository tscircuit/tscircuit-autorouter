import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import type {
  CapacityMeshNode,
  CapacityMeshNodeId,
} from "lib/types/capacity-mesh-types"

class CustomEdgeLookupSolver extends CapacityMeshEdgeSolver {
  edgeExists = false
  observedPairs: Array<[CapacityMeshNodeId, CapacityMeshNodeId]> = []

  override hasEdgeBetween(
    left: CapacityMeshNode,
    right: CapacityMeshNode,
  ): boolean {
    this.observedPairs.push([
      left.capacityMeshNodeId,
      right.capacityMeshNodeId,
    ])
    return this.edgeExists
  }
}

test("target edge finalization respects custom edge lookup methods", (): void => {
  const nodes: CapacityMeshNode[] = ["a", "b", "c"].map(
    (capacityMeshNodeId): CapacityMeshNode => ({
      capacityMeshNodeId,
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layer: "top",
      availableZ: [0],
      _containsTarget: true,
    }),
  )
  for (const edgeExists of [false, true]) {
    const solver = new CustomEdgeLookupSolver(nodes)
    solver.edgeExists = edgeExists
    solver.edges = [{ capacityMeshEdgeId: "existing", nodeIds: ["a", "b"] }]
    solver.handleTargetNodes()
    expect(solver.observedPairs).toEqual([
      ["a", "b"],
      ["a", "c"],
      ["b", "c"],
    ])
    expect(solver.edges.length).toBe(edgeExists ? 1 : 4)
  }
})
