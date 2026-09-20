import { expect, test } from "bun:test"
import { shouldIgnoreSharedEdge } from "lib/solvers/UniformPortDistributionSolver/shouldIgnoreSharedEdge"
import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import type { Obstacle } from "lib/types"

test("shared-edge obstacles block only the copper layers they occupy", (): void => {
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["lower", "upper"],
    ownerPairKey: "lower|upper",
    orientation: "horizontal",
    x1: 0,
    y1: 0,
    x2: 2,
    y2: 0,
    center: { x: 1, y: 0 },
    length: 2,
    nodeSideByOwnerId: { lower: "top", upper: "bottom" },
  }
  const pad: Obstacle = {
    type: "rect",
    center: { x: 1, y: 1 },
    width: 2,
    height: 2,
    layers: ["top"],
    connectedTo: [],
  }
  for (const obstacle of [pad, { ...pad, zLayers: [0] }]) {
    expect(
      shouldIgnoreSharedEdge({
        sharedEdge,
        obstacles: [obstacle],
        z: 0,
        layerCount: 4,
      }),
    ).toBeTrue()
    expect(
      shouldIgnoreSharedEdge({
        sharedEdge,
        obstacles: [obstacle],
        z: 1,
        layerCount: 4,
      }),
    ).toBeFalse()
  }
  expect(
    shouldIgnoreSharedEdge({
      sharedEdge,
      obstacles: [
        { ...pad, layers: ["top", "inner1", "inner2", "bottom"] },
      ],
      z: 1,
      layerCount: 4,
    }),
  ).toBeTrue()
})
