import { expect, test } from "bun:test"
import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import { getFixedCopperClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperClearanceIntervals"

test("fixed copper intervals respect canonical owners layers and actual width without mutation", (): void => {
  const rectangle: FixedCopperRectangle = {
    kind: "fixed-rectangle",
    center: { x: 5, y: 0 },
    width: 2,
    height: 2,
    zLayers: [0, 2],
    ownerNetIds: new Set(["first-owner", "second-owner"]),
  }
  const originalRectangle = structuredClone(rectangle)
  const cases = [
    { z: 0, net: "first-owner", diameter: 0.5, blocked: false },
    { z: 0, net: "second-owner", diameter: 0.5, blocked: false },
    { z: 1, net: "foreign-net", diameter: 0.5, blocked: false },
    { z: 2, net: "foreign-net", diameter: 0.5, blocked: true },
    { z: 0, net: "foreign-net", diameter: 1.5, blocked: true },
    { z: 0, net: "foreign-net", diameter: 0.5, blocked: true },
  ]
  for (const testCase of cases) {
    const intervals = getFixedCopperClearanceIntervals({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      z: testCase.z,
      layerCount: 4,
      canonicalNetId: testCase.net,
      copperDiameter: testCase.diameter,
      minClearance: 0.25,
      rectangles: [rectangle],
    })
    const radius = testCase.diameter / 2 + 0.25
    expect(intervals).toEqual(
      testCase.blocked
        ? [
            { start: 0, end: 4 - radius },
            { start: 6 + radius, end: 10 },
          ]
        : [{ start: 0, end: 10 }],
    )
  }
  const overlappingForeignCopper: FixedCopperRectangle = {
    ...rectangle,
    width: 1,
    ownerNetIds: new Set(["foreign-net"]),
  }
  expect(
    getFixedCopperClearanceIntervals({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      z: 0,
      layerCount: 4,
      canonicalNetId: "first-owner",
      copperDiameter: 0.5,
      minClearance: 0.25,
      rectangles: [rectangle, overlappingForeignCopper],
    }),
  ).toEqual([
    { start: 0, end: 4 },
    { start: 6, end: 10 },
  ])
  expect(rectangle).toEqual(originalRectangle)
})
