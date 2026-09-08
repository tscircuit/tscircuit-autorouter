import { expect, test } from "bun:test"
import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import { getFixedCopperClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperClearanceIntervals"

test("fixed copper intervals preserve exact edge corner and tangent clearances", (): void => {
  const rectangle: FixedCopperRectangle = {
    kind: "fixed-rectangle",
    center: { x: 5, y: 0 },
    width: 2,
    height: 2,
    zLayers: [0],
    ownerNetIds: new Set(["pad-net"]),
  }
  const cases = [
    {
      y: 0,
      expected: [
        { start: 0, end: 2.75 },
        { start: 7.25, end: 10 },
      ],
    },
    {
      y: 1.75,
      expected: [
        { start: 0, end: 3 },
        { start: 7, end: 10 },
      ],
    },
    { y: 2.25, expected: [{ start: 0, end: 10 }] },
  ]
  for (const testCase of cases) {
    const result = getFixedCopperClearanceIntervals({
      start: { x: 0, y: testCase.y },
      end: { x: 10, y: testCase.y },
      z: 0,
      layerCount: 2,
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
      minClearance: 1,
      rectangles: [rectangle],
    })
    expect(result).toEqual(testCase.expected)
  }

  for (const x of [0, 2.75, 5]) {
    const result = getFixedCopperClearanceIntervals({
      start: { x, y: 0 },
      end: { x, y: 0 },
      z: 0,
      layerCount: 2,
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
      minClearance: 1,
      rectangles: [rectangle],
    })
    expect(result).toEqual(x === 5 ? [] : [{ start: 0, end: 0 }])
  }
})
