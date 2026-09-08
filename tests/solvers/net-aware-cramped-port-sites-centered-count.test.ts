import { expect, test } from "bun:test"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { createNetAwareCrampedEndBlockedChannel } from "../fixtures/netAwareCrampedPortSites"

test("one centered placement retains the earliest schedule count inside a positive-slack channel", (): void => {
  const input = createNetAwareCrampedEndBlockedChannel(1)
  const before = structuredClone(input.rectangles)
  const result = getNetAwareCrampedPortSites(input)
  expect(result.status).toBe("complete")
  if (result.status !== "complete") {
    throw new Error("The positive-slack binary channel must resolve")
  }
  expect(result.intervals).toEqual([{ start: 0, end: 1.25 }])
  expect(result.pitch).toBe(0.5)
  expect(result.capacity).toBe(3)
  expect(result.sites.map((site): number => site.x)).toEqual([
    0.125, 0.625, 1.125,
  ])
  expect(result.representedEmptyIntervals).toEqual([])
  for (const [index, site] of result.sites.entries()) {
    expect(site.x).toBeGreaterThan(0)
    expect(site.x).toBeLessThan(1.25)
    expect(site.allowedNetIds).toEqual(["route-net"])
    if (index > 0) {
      expect(site.x - result.sites[index - 1]!.x).toBe(result.pitch)
    }
    expect(
      input.clearanceIndex.isPointClear({
        point: site,
        canonicalNetId: "route-net",
        copperDiameter: input.traceWidth,
      }),
    ).toBe(true)
  }
  expect(input.rectangles).toEqual(before)
  expect(input.existingPoint).toEqual({ x: 1.5, y: 0, z: 0 })
})
