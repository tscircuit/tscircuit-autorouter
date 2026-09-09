import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { getFixedCopperClearanceIntervals } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperClearanceIntervals"
import { addWithDirectedRounding } from "lib/utils/addWithDirectedRounding"

type PointMaskQuery = Parameters<
  FixedCopperClearanceIndex["getAllowedNetIdsAtPoint"]
>[0]

class CenteredSiteDisagreementIndex extends FixedCopperClearanceIndex {
  readonly queriedX: number[] = []
  readonly rejectedCoordinate: number

  constructor(rectangles: readonly FixedCopperRectangle[], coordinate: number) {
    super({
      rectangles,
      layerCount: 1,
      minClearance: 0.25,
    })
    this.rejectedCoordinate = coordinate
  }

  override getAllowedNetIdsAtPoint(
    query: PointMaskQuery,
  ): ReadonlySet<string> | null {
    this.queriedX.push(query.point.x)
    const actualMask = super.getAllowedNetIdsAtPoint(query)
    // Explicitly simulate a predicate disagreement inside a positive-width
    // channel. Centering must not retry a different point or drop the channel.
    if (query.point.x === this.rejectedCoordinate) return new Set()
    return actualMask
  }
}

test("an index-rejected centered site exposes evidence without a retry or partial packing", (): void => {
  const rectangles: FixedCopperRectangle[] = [
    {
      kind: "fixed-rectangle",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      ccwRotationDegrees: 45,
      zLayers: [0],
      ownerNetIds: new Set(["foreign-pad"]),
    },
  ]
  const start = { x: -3, y: 0 }
  const end = { x: 3, y: 0 }
  const analytic = getFixedCopperClearanceIntervals({
    start,
    end,
    z: 0,
    layerCount: 1,
    canonicalNetId: "route-net",
    copperDiameter: 0.5,
    minClearance: 0.25,
    rectangles,
  })
  // Both channels have three sites at pitch .5. The first right-channel site
  // has latest coordinate 2; its centered target is strictly inside the channel.
  const earliestRight = addWithDirectedRounding(
    start.x,
    analytic[1]!.start,
    "up",
  )
  const rejectedCoordinate = earliestRight + (2 - earliestRight) / 2
  const clearanceIndex = new CenteredSiteDisagreementIndex(
    rectangles,
    rejectedCoordinate,
  )
  const result = getNetAwareCrampedPortSites({
    start,
    end,
    existingPoint: { x: 0, y: 0, z: 0 },
    layerCount: 1,
    traceWidth: 0.5,
    traceGap: 0,
    padGap: 0.25,
    routableNetIds: new Set(["route-net"]),
    rectangles,
    clearanceIndex,
  })
  expect(result.status).toBe("unresolved-index-boundary")
  if (result.status !== "unresolved-index-boundary") {
    throw new Error(
      "A rejected analytic site must remain explicitly unresolved",
    )
  }
  expect(result.reason).toBe("packed-site-blocked-by-index")
  expect(result.attemptedSite).toEqual({
    x: rejectedCoordinate,
    y: 0,
    z: 0,
  })
  expect(result.netClasses[0]!.distanceIntervals).toEqual(analytic)
  expect(result.intervals).toHaveLength(2)
  expect(result.representedEmptyIntervals).toEqual([])
  expect(rejectedCoordinate).toBeGreaterThan(earliestRight)
  expect(rejectedCoordinate).toBeLessThan(3)
  expect("sites" in result).toBe(false)
  expect("capacity" in result).toBe(false)
  expect(clearanceIndex.queriedX).toHaveLength(5)
  expect(clearanceIndex.queriedX[0]).toBe(0)
  expect(clearanceIndex.queriedX.slice(1, 4).every((x): boolean => x < 0)).toBe(
    true,
  )
  expect(clearanceIndex.queriedX.at(-1)).toBe(rejectedCoordinate)
})
