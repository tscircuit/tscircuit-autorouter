import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"

test("fixed copper clearance measures rectangle edges and rounded corners exactly", (): void => {
  const rectangle: FixedCopperRectangle = {
    kind: "fixed-rectangle",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    zLayers: [0],
    ownerNetIds: new Set(["pad-net"]),
  }
  const index = new FixedCopperClearanceIndex({
    rectangles: [rectangle],
    layerCount: 2,
    minClearance: 0.25,
  })
  const cases = [
    { point: { x: 1.5, y: 0, z: 0 }, clear: true },
    { point: { x: 1.49, y: 0, z: 0 }, clear: false },
    { point: { x: 0, y: 0, z: 0 }, clear: false },
    { point: { x: 1.4, y: 1.4, z: 0 }, clear: true },
    { point: { x: 1.25, y: 1.25, z: 0 }, clear: false },
  ]
  for (const testCase of cases) {
    expect(
      index.isPointClear({
        point: testCase.point,
        canonicalNetId: "route-net",
        copperDiameter: 0.5,
      }),
    ).toBe(testCase.clear)
  }

  const zeroClearanceIndex = new FixedCopperClearanceIndex({
    rectangles: [rectangle],
    layerCount: 2,
    minClearance: 0,
  })
  expect(
    zeroClearanceIndex.isPointClear({
      point: { x: 1.25, y: 0, z: 0 },
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
    }),
  ).toBeTrue()
  expect(
    zeroClearanceIndex.isPointClear({
      point: { x: 1.2, y: 0, z: 0 },
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
    }),
  ).toBeFalse()
})
