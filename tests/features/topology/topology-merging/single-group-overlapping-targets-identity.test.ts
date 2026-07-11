import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("topology merging preserves one group with overlapping targets exactly", (): void => {
  const nodes = [
    {
      ...createTopologyMergingTestNode({
        id: "target-a",
        bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
        availableZ: [0],
      }),
      _depth: 3,
      _containsObstacle: true,
      _completelyInsideObstacle: true,
      _containsTarget: true,
      _targetConnectionName: "connection-a",
      _adjacentNodeIds: ["free-a"],
    },
    {
      ...createTopologyMergingTestNode({
        id: "target-b",
        bounds: { minX: 1, maxX: 3, minY: 1, maxY: 3 },
        availableZ: [0],
      }),
      _depth: 4,
      _containsObstacle: true,
      _completelyInsideObstacle: false,
      _containsTarget: true,
      _targetConnectionName: "connection-b",
      _adjacentNodeIds: ["free-b"],
    },
  ]
  const expectedNodes = structuredClone(nodes)

  const output = solveTopologyMergingTestGroups([
    { groupId: "global", nodes, isComponent: false },
  ])

  expect(output).toEqual(expectedNodes)
  expect(output.map((node) => node.capacityMeshNodeId)).toEqual([
    "target-a",
    "target-b",
  ])
})
