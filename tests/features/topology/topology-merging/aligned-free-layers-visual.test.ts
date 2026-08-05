import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { createTopologyMergingTestNode } from "tests/fixtures/topology-merging-test-utils"

test("visualizes aligned free space on two layers", async () => {
  const bounds = { minX: 0, maxX: 2, minY: 0, maxY: 2 }
  const input = {
    layerCount: 2,
    viaDiameter: 0.6,
    nodeGroups: [
      {
        groupId: "top-layer",
        isComponent: true,
        nodes: [
          createTopologyMergingTestNode({
            id: "top-free",
            bounds,
            availableZ: [0],
          }),
        ],
      },
      {
        groupId: "bottom-layer",
        isComponent: true,
        nodes: [
          createTopologyMergingTestNode({
            id: "bottom-free",
            bounds,
            availableZ: [1],
          }),
        ],
      },
    ],
  }
  const solver = new TopologyMergingSolver(input)
  solver.solve()

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Aligned free space",
          step: "end",
          iteration: solver.iterations,
          graphics: solver.visualize(),
          layer: "split",
        },
      ],
      columns: 1,
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
