import { expect, test } from "bun:test";
import {
  createTopologyMergingTestNode,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils";

test("topology merging reconstructs same-group overlapping targets with another group present", (): void => {
  const targetNodes = [
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
    },
  ];
  const output = solveTopologyMergingTestGroups([
    { groupId: "global", nodes: targetNodes, isComponent: false },
    {
      groupId: "disjoint-component",
      nodes: [
        createTopologyMergingTestNode({
          id: "disjoint-region",
          bounds: { minX: 10, maxX: 12, minY: 0, maxY: 2 },
          availableZ: [0, 1],
        }),
      ],
      isComponent: true,
    },
  ]);
  const restoredTargets = output.filter((node) => node._containsTarget);

  expect(restoredTargets).toHaveLength(2);
  expect(restoredTargets).toMatchObject(targetNodes);
});
