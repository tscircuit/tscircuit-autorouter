import { expect, test } from "bun:test"
import {
  type TopologyMergingOutputProvenance,
  validateTopologyMergingOutput,
} from "lib/solvers/TopologyMergingSolver/topology-merging-output"
import type { PreparedTopologyMergingNode } from "lib/solvers/TopologyMergingSolver/topology-merging-types"
import { createTopologyMergingTestNode } from "tests/fixtures/topology-merging-test-utils"

test("topology merging spatial validation detects shared-layer overlaps", () => {
  const nodeA = createTopologyMergingTestNode({
    id: "node-a",
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
    availableZ: [0],
  })
  const nodeB = createTopologyMergingTestNode({
    id: "node-b",
    bounds: { minX: 1, minY: 1, maxX: 3, maxY: 3 },
    availableZ: [0],
  })
  const preparedNodeBySourceKey = new Map<
    string,
    PreparedTopologyMergingNode
  >([
    [
      "group-a:node-a",
      {
        sourceKey: "group-a:node-a",
        groupIndex: 0,
        node: nodeA,
        bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      },
    ],
    [
      "group-b:node-b",
      {
        sourceKey: "group-b:node-b",
        groupIndex: 1,
        node: nodeB,
        bounds: { minX: 1, minY: 1, maxX: 3, maxY: 3 },
      },
    ],
  ])
  const provenance: TopologyMergingOutputProvenance = {
    groupIndexesByNodeId: new Map([
      ["node-a", [0]],
      ["node-b", [1]],
    ]),
    sourceKeysByNodeId: new Map([
      ["node-a", ["group-a:node-a"]],
      ["node-b", ["group-b:node-b"]],
    ]),
  }

  expect(() =>
    validateTopologyMergingOutput({
      nodes: [nodeA, nodeB],
      preparedNodeBySourceKey,
      provenance,
    }),
  ).toThrow("unresolved inter-group overlap")
})
