import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import {
  createTopologyMergingTestNode,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("topology merging preserves connectivity of overlapping free regions", (): void => {
  const output = solveTopologyMergingTestGroups([
    {
      groupId: "global",
      isComponent: false,
      nodes: [
        createTopologyMergingTestNode({
          id: "outer",
          bounds: { minX: 0, maxX: 10, minY: 0.000001, maxY: 2 },
          availableZ: [0, 1],
        }),
        createTopologyMergingTestNode({
          id: "inner",
          bounds: { minX: 4, maxX: 6, minY: 0, maxY: 1 },
          availableZ: [0, 1],
        }),
      ],
    },
    {
      groupId: "component",
      isComponent: true,
      nodes: [createTopologyMergingTestNode({
        id: "remote",
        bounds: { minX: 20, maxX: 21, minY: 0, maxY: 1 },
        availableZ: [0, 1],
      })],
    },
  ])
  const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(output)
  edges.solve()
  const globalIds = new Set(output.filter((node) => node.center.x < 10)
    .map((node) => node.capacityMeshNodeId))
  const pending = [globalIds.values().next().value!]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    for (const edge of edges.edges) {
      if (!edge.nodeIds.includes(id)) continue
      pending.push(...edge.nodeIds.filter((other) => globalIds.has(other)))
    }
  }

  expect(visited.size).toBe(globalIds.size)
})
