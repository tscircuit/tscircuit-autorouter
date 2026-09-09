import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { addWithDirectedRounding } from "lib/utils/addWithDirectedRounding"

test("decimal pitch advances conservatively across one union and unrestricted sites use actual nets", (): void => {
  const rectangles: FixedCopperRectangle[] = [
    {
      kind: "fixed-rectangle",
      center: { x: 0, y: 0 },
      width: 0.25,
      height: 0.25,
      zLayers: [0],
      ownerNetIds: new Set(),
    },
  ]
  const clearanceIndex = new FixedCopperClearanceIndex({
    rectangles,
    layerCount: 1,
    minClearance: 0.0625,
  })
  const result = getNetAwareCrampedPortSites({
    start: { x: -1, y: 0 },
    end: { x: 1, y: 0 },
    existingPoint: { x: 0, y: 0, z: 0 },
    layerCount: 1,
    traceWidth: 0.125,
    traceGap: 0.1,
    padGap: 0.0625,
    routableNetIds: new Set(["net-b", "net-a"]),
    rectangles,
    clearanceIndex,
  })
  expect(result.status).toBe("complete")
  if (result.status !== "complete") {
    throw new Error("Exact rectangle bounds with decimal pitch must resolve")
  }
  expect(result.intervals).toEqual([
    { start: -1, end: -0.25 },
    { start: 0.25, end: 1 },
  ])
  expect(result.pitch).toBe(addWithDirectedRounding(0.125, 0.1, "up"))
  expect(result.capacity).toBe(8)
  for (const [index, site] of result.sites.entries()) {
    expect(site.allowedNetIds).toEqual(["net-a", "net-b"])
    expect(
      clearanceIndex.getAllowedNetIdsAtPoint({
        point: site,
        copperDiameter: 0.125,
      }),
    ).toBeNull()
    if (index === 0) continue
    expect(site.x).toBeGreaterThanOrEqual(
      addWithDirectedRounding(result.sites[index - 1]!.x, result.pitch, "up"),
    )
  }
})
