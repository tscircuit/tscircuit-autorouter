import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"

const createNode = ({
  capacityMeshNodeId,
  x,
  y,
  containsTarget = false,
  containsObstacle = false,
}: {
  capacityMeshNodeId: CapacityMeshNodeId
  x: number
  y: number
  containsTarget?: boolean
  containsObstacle?: boolean
}): CapacityMeshNode => ({
  capacityMeshNodeId,
  center: { x, y },
  width: 1,
  height: 1,
  layer: "z0",
  availableZ: [0],
  _containsTarget: containsTarget,
  _containsObstacle: containsObstacle,
  ...(containsTarget ? { _targetConnectionName: "source_net_1" } : {}),
})

const getUndirectedEdgeKeys = (
  edges: Array<{ nodeIds: [CapacityMeshNodeId, CapacityMeshNodeId] }>,
) => edges.map(({ nodeIds }) => [...nodeIds].sort().join(":")).sort()

test("spatial edge candidates preserve brute-force connectivity", () => {
  const nodes = [
    createNode({ capacityMeshNodeId: "left", x: -1, y: 0 }),
    createNode({ capacityMeshNodeId: "center", x: 0, y: 0 }),
    createNode({ capacityMeshNodeId: "above", x: 0, y: 1 }),
    createNode({ capacityMeshNodeId: "diagonal", x: 1, y: 1 }),
    createNode({
      capacityMeshNodeId: "target_a",
      x: 2,
      y: 0,
      containsTarget: true,
      containsObstacle: true,
    }),
    createNode({
      capacityMeshNodeId: "target_b",
      x: 2.25,
      y: 0,
      containsTarget: true,
    }),
    createNode({ capacityMeshNodeId: "target_neighbor", x: 3, y: 0 }),
  ]
  const bruteForceSolver = new CapacityMeshEdgeSolver(nodes)
  const spatialSolver = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)

  bruteForceSolver.solve()
  spatialSolver.solve()

  expect(getUndirectedEdgeKeys(spatialSolver.edges)).toEqual(
    getUndirectedEdgeKeys(bruteForceSolver.edges),
  )
})
