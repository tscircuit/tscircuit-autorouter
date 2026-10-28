import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("topology merging preserves free regions across nearby coordinate boundaries", (): void => {
  const freeRegion = createTopologyMergingTestNode({
    id: "free-region",
    bounds: { minX: 0, maxX: 10, minY: 0.000001, maxY: 2 },
    availableZ: [0, 1],
  })
  const output = solveTopologyMergingTestGroups([
    {
      groupId: "global",
      isComponent: false,
      nodes: [
        freeRegion,
        createTopologyMergingTestNode({
          id: "overlapping-free-region",
          bounds: { minX: 4, maxX: 6, minY: 0, maxY: 1 },
          availableZ: [0, 1],
        }),
      ],
    },
    {
      groupId: "component",
      isComponent: true,
      nodes: [
        createTopologyMergingTestNode({
          id: "component-region",
          bounds: { minX: 20, maxX: 21, minY: 0, maxY: 1 },
          availableZ: [0, 1],
        }),
      ],
    },
  ])

  expect(output).toHaveLength(3)
  const restoredRegion = output.find(
    (node) => node.capacityMeshNodeId === "free-region",
  )
  const { height, ...expectedRegion } = freeRegion
  expect(restoredRegion).toMatchObject(expectedRegion)
  expect(restoredRegion!.height).toBeCloseTo(height, 12)
})
