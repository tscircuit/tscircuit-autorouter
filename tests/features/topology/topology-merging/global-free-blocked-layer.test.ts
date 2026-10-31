import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createTopologyMergingTestNode } from "tests/fixtures/topology-merging-test-utils"

test("does not merge clear layer ranges across an intervening pad", () => {
  const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  const solver = new TopologyMergingSolver({
    layerCount: 4,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [createTopologyMergingTestNode({
          id: "clear-space",
          bounds,
          availableZ: [0, 2, 3],
        })],
      },
      {
        groupId: "component",
        isComponent: true,
        nodes: [{
          ...createTopologyMergingTestNode({
            id: "pad",
            bounds,
            availableZ: [1],
          }),
          _containsObstacle: true,
          _containsTarget: true,
          _connectedTo: ["pad-net"],
        }],
      },
    ],
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  const freeRegions = solver.getOutput().filter((node) => !node._containsObstacle)
  expect(freeRegions.map((node) => node.availableZ)).toEqual([[0], [2, 3]])
})
