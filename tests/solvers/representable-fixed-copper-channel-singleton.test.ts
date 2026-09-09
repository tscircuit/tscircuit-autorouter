import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { getRepresentableFixedCopperClearanceChannel } from "lib/solvers/UniformPortDistributionSolver/getRepresentableFixedCopperClearanceChannel"

test("clear equality boundaries and signed-zero singleton witnesses remain exact", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: -1 },
        width: 1,
        height: 1,
        zLayers: [0],
        ownerNetIds: new Set(["first-pad-net"]),
      },
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 1 },
        width: 1,
        height: 1,
        zLayers: [0],
        ownerNetIds: new Set(["second-pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.25,
  })
  const singleton = getRepresentableFixedCopperClearanceChannel({
    interval: { start: -0, end: 0 },
    axis: "y",
    fixedCoordinate: 0,
    z: 0,
    selectedCoordinate: -0,
    canonicalNetId: "route-net",
    copperDiameter: 0.5,
    clearanceIndex: index,
  })
  expect(Object.is(singleton.start, -0)).toBe(true)
  expect(Object.is(singleton.end, 0)).toBe(true)
  const equality = getRepresentableFixedCopperClearanceChannel({
    interval: { start: -3, end: -2 },
    axis: "y",
    fixedCoordinate: 0,
    z: 0,
    selectedCoordinate: -2,
    canonicalNetId: "route-net",
    copperDiameter: 0.5,
    clearanceIndex: index,
  })
  expect(equality).toEqual({ start: -3, end: -2 })
})
