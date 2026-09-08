import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { getRepresentableFixedCopperClearanceChannel } from "lib/solvers/UniformPortDistributionSolver/getRepresentableFixedCopperClearanceChannel"

test("a blocked selected witness fails instead of choosing another available channel", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.25,
  })
  expect((): void => {
    getRepresentableFixedCopperClearanceChannel({
      interval: { start: -2, end: 2 },
      axis: "x",
      fixedCoordinate: 0,
      z: 0,
      selectedCoordinate: 0,
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
      clearanceIndex: index,
    })
  }).toThrow("requires a physically clear selected witness")
})
