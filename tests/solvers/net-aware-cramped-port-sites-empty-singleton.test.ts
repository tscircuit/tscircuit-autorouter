import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { createNetAwareCrampedContact } from "../fixtures/netAwareCrampedPortSites"

type PointMaskQuery = Parameters<
  FixedCopperClearanceIndex["getAllowedNetIdsAtPoint"]
>[0]

class IndexEmptySingleton extends FixedCopperClearanceIndex {
  override getAllowedNetIdsAtPoint(
    query: PointMaskQuery,
  ): ReadonlySet<string> | null {
    const actual = super.getAllowedNetIdsAtPoint(query)
    // Model a numerical disagreement at the sole represented tangent point.
    if (query.point.y === 0) {
      return new Set<string>()
    }
    return actual
  }
}

test("an index-empty singleton is explicit evidence and does not discard wider usable components", (): void => {
  const original = createNetAwareCrampedContact()
  const clearanceIndex = new IndexEmptySingleton({
    rectangles: original.rectangles,
    layerCount: original.layerCount,
    minClearance: original.padGap,
  })
  const result = getNetAwareCrampedPortSites({
    ...original,
    start: { x: 0, y: -3 },
    end: { x: 0, y: 3 },
    clearanceIndex,
  })
  expect(result.status).toBe("complete")
  if (result.status !== "complete") {
    throw new Error(
      "A proven empty singleton must not invalidate other channels",
    )
  }
  expect(result.intervals).toEqual([
    { start: -3, end: -2 },
    { start: 0, end: 0 },
    { start: 2, end: 3 },
  ])
  expect(result.representedEmptyIntervals).toEqual([
    {
      intervalIndex: 1,
      interval: { start: 0, end: 0 },
      point: { x: 0, y: 0, z: 0 },
      reason: "index-blocked-singleton",
    },
  ])
  expect(result.capacity).toBe(6)
  expect(result.sites.map((site): number => site.y)).toEqual([
    -3, -2.5, -2, 2, 2.5, 3,
  ])
  for (const site of result.sites) {
    expect(site.allowedNetIds).toEqual(["route-net"])
    expect(site.y).not.toBe(0)
    expect(
      clearanceIndex.getAllowedNetIdsAtPoint({
        point: site,
        copperDiameter: original.traceWidth,
      }),
    ).toBeNull()
  }
})
