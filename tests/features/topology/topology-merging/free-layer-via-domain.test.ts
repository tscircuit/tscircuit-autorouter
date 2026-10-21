import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import {
  createTopologyMergingTestNode,
  getAvailableZAtPoint,
} from "../../../fixtures/topology-merging-test-utils"

test("overlapping free layer domains expose a through-via region", (): void => {
  const input = {
    layerCount: 2,
    minViaPadDiameter: 0.3,
    nodeGroups: [
      {
        groupId: "component",
        isComponent: false,
        nodes: [
          createTopologyMergingTestNode({
            id: "top",
            bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
            availableZ: [0],
          }),
          createTopologyMergingTestNode({
            id: "bottom",
            bounds: { minX: 1, maxX: 3, minY: 0, maxY: 2 },
            availableZ: [1],
          }),
        ],
      },
    ],
  }
  const solver = new TopologyMergingSolver(input)
  solver.solve()
  const nodes = solver.getOutput()
  expect(solver.reconstructedViaDomainCount).toBe(1)
  expect(getAvailableZAtPoint(nodes, { x: 1.5, y: 1 })).toEqual([[0, 1]])
  expect(getAvailableZAtPoint(nodes, { x: 0.5, y: 1 })).toEqual([[0]])
  expect(getAvailableZAtPoint(nodes, { x: 2.5, y: 1 })).toEqual([[1]])
  for (const z of [0, 1]) {
    expect(
      nodes
        .filter((node) => node.availableZ.includes(z))
        .reduce((area, node) => area + node.width * node.height, 0),
    ).toBe(4)
  }
})
