import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshEdgeSolver3_Flatbush } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver3_Flatbush"
import type { CapacityMeshEdge, CapacityMeshNode } from "lib/types"

const createNode = (
  capacityMeshNodeId: string,
  center: { x: number; y: number },
  width: number,
  height: number,
  availableZ: number[] = [0, 1],
): CapacityMeshNode => ({
  capacityMeshNodeId,
  center,
  width,
  height,
  layer: "top",
  availableZ,
})

const getSortedNodePairs = (edges: CapacityMeshEdge[]): string[] =>
  edges
    .map((edge) => [...edge.nodeIds].sort().join("-"))
    .sort((a, b) => a.localeCompare(b))

test("Flatbush edge solver matches the exhaustive capacity mesh graph", () => {
  const nodes: CapacityMeshNode[] = [
    createNode("wide", { x: 0, y: 0 }, 10, 2),
    createNode("right", { x: 5.5, y: 0 }, 1, 1),
    createNode("top", { x: 0, y: 1.5 }, 2, 1),
    createNode("corner_only", { x: 5.5, y: 1.5 }, 1, 1),
    createNode("overlapping", { x: 0, y: 0 }, 1, 1),
    createNode("wrong_layer", { x: -5.5, y: 0 }, 1, 1, [2]),
    {
      ...createNode("straw_a", { x: 10, y: 0 }, 1, 1),
      _strawNode: true,
      _strawParentCapacityMeshNodeId: "straw_parent",
    },
    {
      ...createNode("straw_b", { x: 11, y: 0 }, 1, 1),
      _strawNode: true,
      _strawParentCapacityMeshNodeId: "straw_parent",
    },
  ]
  const exhaustiveSolver = new CapacityMeshEdgeSolver(nodes)
  const flatbushSolver = new CapacityMeshEdgeSolver3_Flatbush(nodes)

  exhaustiveSolver.solve()
  flatbushSolver.solve()

  const expectedNodePairs = getSortedNodePairs(exhaustiveSolver.edges)
  const actualNodePairs = getSortedNodePairs(flatbushSolver.edges)
  expect(actualNodePairs).toEqual(expectedNodePairs)
  expect(new Set(actualNodePairs).size).toBe(actualNodePairs.length)
  expect(actualNodePairs).toContain("right-wide")
  expect(actualNodePairs).not.toContain("straw_a-straw_b")
  expect(actualNodePairs).not.toContain("wide-wrong_layer")
})

test("Flatbush edge solver handles an empty capacity mesh", () => {
  const solver = new CapacityMeshEdgeSolver3_Flatbush([])

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.edges).toEqual([])
})
