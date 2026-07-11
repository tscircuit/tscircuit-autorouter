import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("topology merging refines two overlapping every-layer regions", (): void => {
  const allLayers = [0, 1, 2, 3]
  const nodes = solveTopologyMergingTestGroups([
    {
      groupId: "topology-a",
      nodes: [
        createTopologyMergingTestNode({
          id: "a",
          bounds: { minX: 0, maxX: 2, minY: 1, maxY: 4 },
          availableZ: allLayers,
        }),
      ],
    },
    {
      groupId: "topology-b",
      nodes: [
        createTopologyMergingTestNode({
          id: "b",
          bounds: { minX: 1, maxX: 4, minY: 0, maxY: 3 },
          availableZ: allLayers,
        }),
      ],
    },
  ])

  expect(getAvailableZAtPoint(nodes, { x: 1.5, y: 2 })).toEqual([allLayers])
  expect(getAvailableZAtPoint(nodes, { x: 0.5, y: 2 })).toEqual([allLayers])
  expect(getAvailableZAtPoint(nodes, { x: 3, y: 2 })).toEqual([allLayers])
  expect(nodes).toHaveLength(5)
})
