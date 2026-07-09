import { expect, test } from "bun:test"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshNode } from "lib/types"

test("node subdivision preserves small topology merge nodes", (): void => {
  const ordinarySmallNode: CapacityMeshNode = {
    capacityMeshNodeId: "ordinary-small",
    center: { x: 0, y: 0 },
    width: 0.01,
    height: 0.4,
    layer: "z0",
    availableZ: [0],
  }
  const topologySliverNode: CapacityMeshNode = {
    capacityMeshNodeId: "topology-interface-sliver",
    center: { x: 0.1, y: 0 },
    width: 0.01,
    height: 0.4,
    layer: "z0,1",
    availableZ: [0, 1],
    _topologyMergeRole: "interface",
  }
  const solver = new NodeDimensionSubdivisionSolver(
    [ordinarySmallNode, topologySliverNode],
    Number.POSITIVE_INFINITY,
  )

  solver.solve()

  expect(solver.outputNodes.map((node) => node.capacityMeshNodeId)).toEqual([
    "topology-interface-sliver",
  ])
  expect(solver.stats).toMatchObject({
    inputNodeCount: 2,
    outputNodeCount: 1,
    removedSmallNodeCount: 1,
  })
})
