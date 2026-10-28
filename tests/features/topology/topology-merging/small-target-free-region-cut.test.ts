import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("restoring free regions preserves small target cuts on their own layer", (): void => {
  const output = solveTopologyMergingTestGroups([
    {
      groupId: "global",
      isComponent: false,
      nodes: [
        createTopologyMergingTestNode({
          id: "free",
          bounds: { minX: 0, maxX: 10, minY: 0, maxY: 1 },
          availableZ: [0, 1],
        }),
        {
          ...createTopologyMergingTestNode({
            id: "small-target",
            bounds: { minX: 4, maxX: 4.01, minY: 0.5, maxY: 0.51 },
            availableZ: [0],
          }),
          _containsObstacle: true,
          _containsTarget: true,
        },
      ],
    },
    {
      groupId: "component",
      isComponent: true,
      nodes: [createTopologyMergingTestNode({
        id: "remote-component",
        bounds: { minX: 20, maxX: 21, minY: 0, maxY: 1 },
        availableZ: [0, 1],
      })],
    },
  ])

  expect(getAvailableZAtPoint(output, { x: 4.005, y: 0.505 }))
    .toEqual([[0], [1]])
  expect(getAvailableZAtPoint(output, { x: 2, y: 0.5 }))
    .toEqual([[0, 1]])
})
