import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"

test("global centering keeps pitch across channels whose independent centers collide", (): void => {
  const rectangles: FixedCopperRectangle[] = [
    {
      kind: "fixed-rectangle",
      center: { x: 0.1875, y: 0 },
      width: 0.0625,
      height: 1,
      zLayers: [0],
      ownerNetIds: new Set(["foreign-pad"]),
    },
  ]
  const clearanceIndex = new FixedCopperClearanceIndex({
    rectangles,
    layerCount: 1,
    minClearance: 0,
  })
  const result = getNetAwareCrampedPortSites({
    start: { x: 0, y: 0 },
    end: { x: 0.375, y: 0 },
    existingPoint: { x: 0.1875, y: 0, z: 0 },
    layerCount: 1,
    traceWidth: 0.0625,
    traceGap: 0.25,
    padGap: 0,
    routableNetIds: new Set(["route-a", "route-b"]),
    rectangles,
    clearanceIndex,
  })
  expect(result.status).toBe("complete")
  if (result.status !== "complete") {
    throw new Error("The binary-exact global schedule must resolve")
  }
  expect(result.intervals).toEqual([
    { start: 0, end: 0.125 },
    { start: 0.25, end: 0.375 },
  ])
  const independentCenters = result.intervals.map(
    (interval): number => interval.start + (interval.end - interval.start) / 2,
  )
  expect(independentCenters[1]! - independentCenters[0]!).toBeLessThan(
    result.pitch,
  )
  expect(result.pitch).toBe(0.3125)
  expect(result.capacity).toBe(2)
  expect(result.sites.map((site): number => site.x)).toEqual([0.03125, 0.34375])
  expect(result.sites[1]!.x - result.sites[0]!.x).toBe(result.pitch)
  for (const site of result.sites) {
    expect(site.allowedNetIds).toEqual(["route-a", "route-b"])
    expect(
      clearanceIndex.getAllowedNetIdsAtPoint({
        point: site,
        copperDiameter: 0.0625,
      }),
    ).toBeNull()
  }
})
