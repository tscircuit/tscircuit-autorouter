import { expect, test } from "bun:test"
import {
  createTopologyMergingTestNode,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils"

test("topology merging restores a global target over a partial component overlap", (): void => {
  const globalTarget = {
    ...createTopologyMergingTestNode({
      id: "global-target",
      bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
      availableZ: [0],
    }),
    _depth: 3,
    _containsObstacle: true,
    _completelyInsideObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "target-connection",
  }
  const output = solveTopologyMergingTestGroups([
    { groupId: "global", nodes: [globalTarget], isComponent: false },
    {
      groupId: "component",
      nodes: [
        createTopologyMergingTestNode({
          id: "component-region",
          bounds: { minX: 1, maxX: 3, minY: 0, maxY: 2 },
          availableZ: [0, 1],
        }),
      ],
      isComponent: true,
    },
  ])

  expect(
    output.find((node) => node.capacityMeshNodeId === "global-target"),
  ).toMatchObject(globalTarget)
  expect(
    output.find(
      (node) =>
        node._isComponentTopologyNode &&
        node.availableZ.length === 2 &&
        node.availableZ[0] === 0 &&
        node.availableZ[1] === 1,
    ),
  ).toMatchObject({
    center: { x: 2.5, y: 1 },
    width: 1,
    height: 2,
    availableZ: [0, 1],
  })
  expect(
    output.find(
      (node) =>
        node._isComponentTopologyNode &&
        node.availableZ.length === 1 &&
        node.availableZ[0] === 1,
    ),
  ).toMatchObject({
    center: { x: 1.5, y: 1 },
    width: 1,
    height: 2,
    availableZ: [1],
  })
})
