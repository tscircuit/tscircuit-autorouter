import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createTopologyMergingTestNode } from "tests/fixtures/topology-merging-test-utils"

test("topology merging coalesces horizontal regions while scanning", () => {
  const solver = new TopologyMergingSolver({
    layerCount: 2,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [
          createTopologyMergingTestNode({
            id: "global",
            bounds: { minX: 0, minY: 0, maxX: 20, maxY: 2 },
            availableZ: [0],
          }),
        ],
      },
      {
        groupId: "component",
        isComponent: true,
        nodes: Array.from({ length: 20 }, (_, index) =>
          createTopologyMergingTestNode({
            id: `component-${index}`,
            bounds: {
              minX: index,
              minY: 0,
              maxX: index + 1,
              maxY: 2,
            },
            availableZ: [1],
          }),
        ),
      },
    ],
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.stats.atomicRegionCount).toBe(40)
  expect(solver.stats.horizontalRegionRunCount).toBe(21)
})
