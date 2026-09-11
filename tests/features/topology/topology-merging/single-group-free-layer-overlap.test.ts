import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("topology merging connects free layers without merging obstacles", (): void => {
  const nodes = solveTopologyMergingTestGroups([
    {
      groupId: "global",
      nodes: [
        createTopologyMergingTestNode({
          id: "top-free",
          bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
          availableZ: [0],
        }),
        createTopologyMergingTestNode({
          id: "inner-free",
          bounds: { minX: 1, maxX: 3, minY: 0, maxY: 2 },
          availableZ: [2, 3],
        }),
        {
          ...createTopologyMergingTestNode({
            id: "inner-obstacle",
            bounds: { minX: 1, maxX: 3, minY: 0, maxY: 2 },
            availableZ: [1],
          }),
          _containsObstacle: true,
        },
      ],
      isComponent: false,
    },
  ])

  expect(getAvailableZAtPoint(nodes, { x: 1.5, y: 1 })).toEqual([
    [0, 2, 3],
    [1],
  ])
  expect(getAvailableZAtPoint(nodes, { x: 0.5, y: 1 })).toEqual([[0]])
  expect(getAvailableZAtPoint(nodes, { x: 2.5, y: 1 })).toEqual([[1], [2, 3]])
})
