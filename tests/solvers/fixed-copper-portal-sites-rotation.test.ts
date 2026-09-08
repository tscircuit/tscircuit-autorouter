import { expect, test } from "bun:test"
import { getFixedCopperClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperClearanceIntervals"
import {
  type FixedCopperPortalSitesInput,
  getFixedCopperPortalSites,
} from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"

test("portal capacity reuses rotated rectangle intervals without a bounding-box approximation", (): void => {
  const input: FixedCopperPortalSitesInput = {
    start: { x: 0, y: 0 },
    end: { x: 10, y: 0 },
    layerCount: 1,
    zLayers: [0],
    traceWidth: 1,
    traceGap: 0.25,
    padGap: 0,
    routableNetIds: new Set(["route-net"]),
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 3, y: 0 },
        width: 4,
        height: 0.5,
        ccwRotationDegrees: 45,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
  }
  const result = getFixedCopperPortalSites(input)
  const intervals = getFixedCopperClearanceIntervals({
    start: input.start,
    end: input.end,
    z: 0,
    layerCount: 1,
    canonicalNetId: "route-net",
    copperDiameter: 1,
    minClearance: 0,
    rectangles: input.rectangles,
  })
  expect(result.layers[0]!.intervals).toEqual(intervals)
  expect(intervals[0]!.end).toBeCloseTo(3 - 0.75 * Math.SQRT2, 12)
  expect(intervals[1]!.start).toBeCloseTo(3 + 0.75 * Math.SQRT2, 12)
  expect(result.totalCapacity).toBe(7)
  for (const [index, site] of result.layers[0]!.sites.entries()) {
    expect(
      intervals.some(
        (interval): boolean => site.x >= interval.start && site.x <= interval.end,
      ),
    ).toBe(true)
    if (index > 0) {
      expect(
        site.x - result.layers[0]!.sites[index - 1]!.x,
      ).toBeGreaterThanOrEqual(result.pitch)
    }
  }
  expect(
    getFixedCopperPortalSites({
      ...input,
      rectangles: [{ ...input.rectangles[0]!, ccwRotationDegrees: 0 }],
    }).totalCapacity,
  ).toBe(5)
})
