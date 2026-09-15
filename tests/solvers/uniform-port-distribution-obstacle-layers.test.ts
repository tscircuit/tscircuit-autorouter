import { expect, test } from "bun:test"
import { shouldIgnoreSharedEdge } from "lib/solvers/UniformPortDistributionSolver/shouldIgnoreSharedEdge"
import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import type { Obstacle } from "lib/types"

test("a pad blocks redistribution only on its copper layers", () => {
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["left", "right"],
    ownerPairKey: "left|right",
    orientation: "vertical",
    x1: 0.5,
    y1: -0.5,
    x2: 0.5,
    y2: 0.5,
    center: { x: 0.5, y: 0 },
    length: 1,
    nodeSideByOwnerId: { left: "right", right: "left" },
  }
  const pad: Obstacle = {
    type: "rect",
    center: { x: 0.75, y: 0 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: ["pad_net"],
  }
  expect(
    shouldIgnoreSharedEdge({
      sharedEdge,
      obstacles: [pad],
      routingLayer: { z: 0, layerCount: 4 },
    }),
  ).toBe(true)
  expect(
    shouldIgnoreSharedEdge({
      sharedEdge,
      obstacles: [pad],
      routingLayer: { z: 1, layerCount: 4 },
    }),
  ).toBe(false)
  expect(
    shouldIgnoreSharedEdge({
      sharedEdge,
      obstacles: [{ ...pad, zLayers: [0, 1, 2, 3] }],
      routingLayer: { z: 1, layerCount: 4 },
    }),
  ).toBe(true)
  expect(shouldIgnoreSharedEdge({ sharedEdge, obstacles: [pad] })).toBe(true)
})
