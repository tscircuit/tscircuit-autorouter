import { expect, test } from "bun:test";
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
  solveTopologyMergingTestGroups,
} from "../../../fixtures/topology-merging-test-utils";

test("topology merging refines every-layer and all-but-one-layer regions", (): void => {
  const nodes = solveTopologyMergingTestGroups([
    {
      groupId: "topology-a",
      nodes: [
        createTopologyMergingTestNode({
          id: "a",
          bounds: { minX: 0, maxX: 2, minY: 1, maxY: 4 },
          availableZ: [0, 1, 2, 3],
        }),
      ],
    },
    {
      groupId: "topology-b",
      nodes: [
        createTopologyMergingTestNode({
          id: "b",
          bounds: { minX: 1, maxX: 4, minY: 0, maxY: 3 },
          availableZ: [0, 1, 2],
        }),
      ],
    },
  ]);

  expect(getAvailableZAtPoint(nodes, { x: 1.5, y: 2 })).toEqual([
    [0, 1, 2],
    [3],
  ]);
  expect(getAvailableZAtPoint(nodes, { x: 0.5, y: 2 })).toEqual([[0, 1, 2, 3]]);
  expect(getAvailableZAtPoint(nodes, { x: 3, y: 2 })).toEqual([[0, 1, 2]]);
});
