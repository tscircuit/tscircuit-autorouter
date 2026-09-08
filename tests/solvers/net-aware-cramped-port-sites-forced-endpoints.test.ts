import { expect, test } from "bun:test"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { createNetAwareCrampedEndBlockedChannel } from "../fixtures/netAwareCrampedPortSites"

test("fixed maximum count can require clear endpoints and is not claimed strictly interior", (): void => {
  const input = createNetAwareCrampedEndBlockedChannel(1.5)
  const result = getNetAwareCrampedPortSites(input)
  expect(result.status).toBe("complete")
  if (result.status !== "complete") {
    throw new Error("The exact endpoint-forced schedule must resolve")
  }
  expect(result.intervals).toEqual([{ start: 0, end: 1 }])
  expect(result.pitch).toBe(0.5)
  expect(result.capacity).toBe(3)
  expect(result.sites.map((site): number => site.x)).toEqual([0, 0.5, 1])
  expect(result.representedEmptyIntervals).toEqual([])
  for (const site of result.sites) {
    expect(site.allowedNetIds).toEqual(["route-net"])
    expect(
      input.clearanceIndex.isPointClear({
        point: site,
        canonicalNetId: "route-net",
        copperDiameter: input.traceWidth,
      }),
    ).toBe(true)
  }
})
