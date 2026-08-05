import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { createTopologyMergingTestNode } from "tests/fixtures/topology-merging-test-utils"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

test("visualizes local layer access beside a target", async (): Promise<void> => {
  const target = {
    ...createTopologyMergingTestNode({
      id: "top-target",
      bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1 },
      availableZ: [0],
    }),
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: "target-connection",
  }
  const topFreeNodes = [
    createTopologyMergingTestNode({
      id: "top-near-free",
      bounds: { minX: 1, maxX: 3, minY: 0, maxY: 1 },
      availableZ: [0],
    }),
    createTopologyMergingTestNode({
      id: "top-far-free",
      bounds: { minX: 4, maxX: 6, minY: 0, maxY: 1 },
      availableZ: [0],
    }),
  ]
  const bottomFreeNodes = [
    createTopologyMergingTestNode({
      id: "bottom-near-free",
      bounds: { minX: 0, maxX: 3, minY: 0, maxY: 1 },
      availableZ: [1],
    }),
    createTopologyMergingTestNode({
      id: "bottom-far-free",
      bounds: { minX: 4, maxX: 6, minY: 0, maxY: 1 },
      availableZ: [1],
    }),
  ]
  const nodeGroups = [
    {
      groupId: "top-layer-topology",
      nodes: [target, ...topFreeNodes],
      isComponent: true,
    },
    {
      groupId: "bottom-layer-topology",
      nodes: bottomFreeNodes,
      isComponent: true,
    },
  ]
  const solver = new TopologyMergingSolver({
    nodeGroups,
    layerCount: 2,
    viaDiameter: 0.6,
  })
  const inputGraphics: GraphicsObject = {
    rects: nodeGroups.flatMap((group) =>
      group.nodes.map((node) =>
        createRectFromCapacityNode(node, { rectMargin: 0.02 }),
      ),
    ),
  }

  solver.solve()

  expect(solver.solved).toBe(true)
  const outputNodes = solver.getOutput()
  const hasLocalLayerAccess = outputNodes.some(
    (node) =>
      node.availableZ.length === 2 && node.center.x > 1 && node.center.x < 3,
  )
  const hasFarLayerAccess = outputNodes.some(
    (node) => node.availableZ.length === 2 && node.center.x > 4,
  )
  expect(hasFarLayerAccess).toBe(false)

  await expect(
    getGraphicsSvgFrames({
      frames: [
        {
          name: "Input topology: physical X, split by layer",
          graphics: inputGraphics,
          layer: "split",
        },
        {
          name: hasLocalLayerAccess
            ? "Fix: one local multi-layer free region"
            : "Issue: aligned free layers remain separate",
          graphics: solver.visualize(),
          layer: "split",
        },
      ],
      columns: 2,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
