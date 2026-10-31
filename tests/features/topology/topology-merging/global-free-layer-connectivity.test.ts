import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createTopologyMergingTestNode } from "tests/fixtures/topology-merging-test-utils"

test("keeps clear space connected across component and global layer boundaries", () => {
  const solver = new TopologyMergingSolver({
    layerCount: 4,
    allowBlindAndBuriedVias: true,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [-2, 0].map((minX, index) =>
          createTopologyMergingTestNode({
            id: `global-${index}`,
            bounds: { minX, maxX: minX + 2, minY: -1, maxY: 1 },
            availableZ: [0, 1, 2, 3],
          }),
        ),
      },
      {
        groupId: "component",
        isComponent: true,
        nodes: [
          createTopologyMergingTestNode({
            id: "component-surface-space",
            bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
            availableZ: [0],
          }),
        ],
      },
    ],
  })
  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toHaveLength(1)
  expect(solver.getOutput()[0]).toMatchObject({
    center: { x: 0, y: 0 },
    width: 4,
    height: 2,
    availableZ: [0, 1, 2, 3],
  })
  expect(solver.getOutput()[0]._isComponentTopologyNode).toBeFalsy()
})
