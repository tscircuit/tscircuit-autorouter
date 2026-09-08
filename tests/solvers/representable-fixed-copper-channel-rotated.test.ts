import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { getRepresentableFixedCopperClearanceChannel } from "lib/solvers/UniformPortDistributionSolver/getRepresentableFixedCopperClearanceChannel"

test("rotated corner brackets retain the selected witness and certify both world endpoints", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        ccwRotationDegrees: 45,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.25,
  })
  const intervals = [
    { start: -1, end: 3 },
    { start: Math.SQRT2 + 0.5, end: 3 },
  ]
  for (const interval of intervals) {
    const originalInterval = { ...interval }
    const result = getRepresentableFixedCopperClearanceChannel({
      interval,
      axis: "x",
      fixedCoordinate: 0,
      z: 0,
      selectedCoordinate: 2.5,
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
      clearanceIndex: index,
    })
    expect(result.start).toBeGreaterThanOrEqual(interval.start)
    expect(result.start).toBeLessThanOrEqual(2.5)
    expect(result.end).toBeGreaterThanOrEqual(2.5)
    expect(result.end).toBeLessThanOrEqual(interval.end)
    for (const x of [result.start, result.end]) {
      expect(
        index.isPointClear({
          point: { x, y: 0, z: 0 },
          canonicalNetId: "route-net",
          copperDiameter: 0.5,
        }),
      ).toBe(true)
    }
    expect(interval).toEqual(originalInterval)
  }
})
