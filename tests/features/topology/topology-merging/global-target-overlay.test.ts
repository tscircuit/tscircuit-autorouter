import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("topology merging keeps component under-layers below a global target", (): void => {
  const bounds = { minX: 0, maxX: 2, minY: 0, maxY: 2 }
  const globalTarget = {
    ...createTopologyMergingTestNode({
      id: "global-target",
      bounds,
      availableZ: [0],
    }),
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "target-connection",
  }
  const nodes = solveTopologyMergingTestGroups([
    {
      groupId: "global",
      nodes: [globalTarget],
      isComponent: false,
    },
    {
      groupId: "component",
      nodes: [
        createTopologyMergingTestNode({
          id: "component-region",
          bounds,
          availableZ: [0, 1],
        }),
      ],
    },
  ])

  expect(getAvailableZAtPoint(nodes, { x: 1, y: 1 })).toEqual([[0], [1]])
  expect(nodes.find((node) => node.availableZ[0] === 0)).toMatchObject({
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "target-connection",
  })
  expect(nodes.find((node) => node.availableZ[0] === 1)).toMatchObject({
    _containsObstacle: undefined,
    _containsTarget: undefined,
  })
})
