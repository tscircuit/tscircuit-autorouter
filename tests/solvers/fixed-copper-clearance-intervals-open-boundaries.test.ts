import { expect, test } from "bun:test"
import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import { getFixedCopperClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperClearanceIntervals"

test("open forbidden intervals retain touching singletons without inventing clipped endpoint gaps", (): void => {
  const cases = [
    {
      centers: [3, 7],
      width: 2,
      expected: [
        { start: 0, end: 1 },
        { start: 5, end: 5 },
        { start: 9, end: 10 },
      ],
    },
    {
      centers: [3, 6.5],
      width: 2,
      expected: [
        { start: 0, end: 1 },
        { start: 8.5, end: 10 },
      ],
    },
    { centers: [0], width: 2, expected: [{ start: 2, end: 10 }] },
    { centers: [10], width: 2, expected: [{ start: 0, end: 8 }] },
    { centers: [5], width: 10, expected: [] },
    {
      centers: [2],
      width: 2,
      expected: [
        { start: 0, end: 0 },
        { start: 4, end: 10 },
      ],
    },
    {
      centers: [8],
      width: 2,
      expected: [
        { start: 0, end: 6 },
        { start: 10, end: 10 },
      ],
    },
  ]
  for (const testCase of cases) {
    const rectangles = testCase.centers.map((x): FixedCopperRectangle => {
      return {
        kind: "fixed-rectangle",
        center: { x, y: 0 },
        width: testCase.width,
        height: 2,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      }
    })
    const intervals = getFixedCopperClearanceIntervals({
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      z: 0,
      layerCount: 2,
      canonicalNetId: "route-net",
      copperDiameter: 1,
      minClearance: 0.5,
      rectangles,
    })
    expect(intervals).toEqual(testCase.expected)
  }
})
