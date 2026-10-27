import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("topology merging unifies free source partitions covering the full layer stack", (): void => {
  const sharedBounds = { minX: 0, maxX: 2, minY: 0, maxY: 2 }
  const nodes = solveTopologyMergingTestGroups([
    {
      groupId: "topology-a",
      nodes: [
        createTopologyMergingTestNode({
          id: "a-multilayer",
          bounds: sharedBounds,
          availableZ: [1, 2, 3],
        }),
        createTopologyMergingTestNode({
          id: "a-single-layer",
          bounds: sharedBounds,
          availableZ: [0],
        }),
      ],
    },
    {
      groupId: "topology-b",
      nodes: [
        createTopologyMergingTestNode({
          id: "b",
          bounds: sharedBounds,
          availableZ: [0, 1, 2, 3],
        }),
      ],
    },
  ])

  expect(getAvailableZAtPoint(nodes, { x: 1, y: 1 })).toEqual([[0, 1, 2, 3]])
  expect(nodes).toHaveLength(1)
})
