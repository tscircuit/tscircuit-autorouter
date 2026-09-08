import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type PhysicalCopperPoint,
} from "lib/data-structures/FixedCopperClearanceIndex"

test("fixed copper point and segment queries use rotated bounds and exact local geometry", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 3, y: -2 },
        width: 4,
        height: 0.25,
        ccwRotationDegrees: 45,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.1,
  })
  const toWorldPoint = (x: number, y: number): PhysicalCopperPoint => {
    const angle = Math.PI / 4
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    return {
      x: 3 + x * cos - y * sin,
      y: -2 + x * sin + y * cos,
      z: 0,
    }
  }
  const cases = [
    { point: toWorldPoint(1.5, 0), clear: false },
    { point: toWorldPoint(0, 1), clear: true },
    { point: toWorldPoint(0, 0.2), clear: false },
    { point: toWorldPoint(2.5, 0), clear: true },
  ]
  for (const testCase of cases) {
    expect(
      index.isPointClear({
        point: testCase.point,
        canonicalNetId: "route-net",
        copperDiameter: 0.2,
      }),
    ).toBe(testCase.clear)
  }

  const start = toWorldPoint(-3, 0)
  const end = toWorldPoint(3, 0)
  expect(
    index.isSegmentClear({
      start,
      end,
      canonicalNetId: "route-net",
      copperDiameter: 0.2,
    }),
  ).toBeFalse()
  expect(
    index.isSegmentClear({
      start: end,
      end: start,
      canonicalNetId: "route-net",
      copperDiameter: 0.2,
    }),
  ).toBeFalse()
  expect(
    index.isSegmentClear({
      start: toWorldPoint(-1, 1),
      end: toWorldPoint(1, 1),
      canonicalNetId: "route-net",
      copperDiameter: 0.2,
    }),
  ).toBeTrue()
})
