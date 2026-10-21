import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
} from "../../../fixtures/topology-merging-test-utils"

test("a free intersection narrower than the via remains layer-separated", (): void => {
  const bounds = { minX: 0, maxX: 0.2, minY: 0, maxY: 2 }
  const solver = new TopologyMergingSolver({
    layerCount: 2,
    minViaPadDiameter: 0.3,
    nodeGroups: [
      {
        groupId: "component",
        isComponent: false,
        nodes: [0, 1].map((z) =>
          createTopologyMergingTestNode({
            id: `layer-${z}`,
            bounds,
            availableZ: [z],
          }),
        ),
      },
    ],
  })
  solver.solve()
  expect(getAvailableZAtPoint(solver.getOutput(), { x: 0.1, y: 1 })).toEqual([
    [0],
    [1],
  ])
  expect(
    solver
      .getOutput()
      .map((node) => node.capacityMeshNodeId)
      .sort(),
  ).toEqual(["layer-0", "layer-1"])
})
