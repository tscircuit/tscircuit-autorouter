import { expect, test } from "bun:test"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshNode } from "lib/types"

const createExpectedChildren = (
  node: CapacityMeshNode,
  { rows, cols }: { rows: number; cols: number },
): CapacityMeshNode[] => {
  return Array.from({ length: rows * cols }, (_, index) => ({
    ...node,
    capacityMeshNodeId: `${node.capacityMeshNodeId}__sub_${Math.floor(index / cols)}_${index % cols}`,
    center: {
      x:
        node.center.x -
        node.width / 2 +
        (node.width / cols) * ((index % cols) + 0.5),
      y:
        node.center.y -
        node.height / 2 +
        (node.height / rows) * (Math.floor(index / cols) + 0.5),
    },
    width: node.width / cols,
    height: node.height / rows,
    availableZ: [...node.availableZ],
  }))
}

test("indexed bridges preserve ordered children and metadata", (): void => {
  const nodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "bottom",
      center: { x: -0.4, y: 0.12 },
      width: 0.2,
      height: 0.2,
      availableZ: [1, 0],
      layer: "top",
    },
    {
      capacityMeshNodeId: "bridge",
      center: { x: -0.4, y: 0 },
      width: 0.2,
      height: 0.04,
      availableZ: [0],
      layer: "top",
      _isComponentTopologyNode: true,
      _connectedTo: ["connection"],
    },
    {
      capacityMeshNodeId: "top",
      center: { x: -0.4, y: -0.12 },
      width: 0.2,
      height: 0.2,
      availableZ: [0, 1],
      layer: "top",
    },
  ]
  const unchangedNodes = structuredClone(nodes)
  const solver = new NodeDimensionSubdivisionSolver(nodes, 0.08, 4)
  solver.solve()
  expect(solver.outputNodes).toEqual([
    ...createExpectedChildren(nodes[0]!, { rows: 3, cols: 3 }),
    ...createExpectedChildren(nodes[1]!, { rows: 1, cols: 3 }),
    ...createExpectedChildren(nodes[2]!, { rows: 3, cols: 3 }),
  ])
  expect(solver.stats.subdividedNodeCount).toBe(3)
  expect(solver.stats.removedSmallNodeCount).toBe(0)
  expect(nodes).toEqual(unchangedNodes)
})
