import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { getRepresentableFixedCopperClearanceChannel } from "lib/solvers/UniformPortDistributionSolver/getRepresentableFixedCopperClearanceChannel"

test("world-coordinate decimal endpoints refine to clear values on either side of zero", (): void => {
  for (const direction of [1, -1]) {
    const index = new FixedCopperClearanceIndex({
      rectangles: [
        {
          kind: "fixed-rectangle",
          center: { x: direction * 10.4, y: 20 },
          width: 0.2,
          height: 0.2,
          zLayers: [0],
          ownerNetIds: new Set(["pad-net"]),
        },
      ],
      layerCount: 2,
      minClearance: 0.1,
    })
    const interval =
      direction === 1 ? { start: 10.7, end: 11 } : { start: -11, end: -10.7 }
    const originalInterval = { ...interval }
    const result = getRepresentableFixedCopperClearanceChannel({
      interval,
      axis: "x",
      fixedCoordinate: 20,
      z: 0,
      selectedCoordinate: direction * 10.9,
      canonicalNetId: "route-net",
      copperDiameter: 0.2,
      clearanceIndex: index,
    })
    expect(result).toEqual(
      direction === 1
        ? { start: 10.700000000000001, end: 11 }
        : { start: -11, end: -10.700000000000001 },
    )
    for (const x of [result.start, result.end]) {
      expect(
        index.isPointClear({
          point: { x, y: 20, z: 0 },
          canonicalNetId: "route-net",
          copperDiameter: 0.2,
        }),
      ).toBe(true)
    }
    expect(interval).toEqual(originalInterval)
  }
})
