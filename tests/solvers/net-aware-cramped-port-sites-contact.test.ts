import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { createNetAwareCrampedContact } from "../fixtures/netAwareCrampedPortSites"

test("a closed exact-contact singleton survives while a genuinely closed channel has zero sites", (): void => {
  const input = createNetAwareCrampedContact()
  const result = getNetAwareCrampedPortSites(input)
  expect(result.status).toBe("complete")
  if (result.status !== "complete") {
    throw new Error("The binary-exact contact must be resolved")
  }
  expect(result.intervals).toEqual([{ start: 0, end: 0 }])
  expect(result.representedEmptyIntervals).toEqual([])
  expect(result.capacity).toBe(1)
  expect(result.sites).toEqual([
    { index: 0, x: 0, y: 0, z: 0, allowedNetIds: ["route-net"] },
  ])
  const closed = getNetAwareCrampedPortSites({
    ...input,
    padGap: 0.25,
    clearanceIndex: new FixedCopperClearanceIndex({
      rectangles: input.rectangles,
      layerCount: input.layerCount,
      minClearance: 0.25,
    }),
  })
  expect(closed.status).toBe("complete")
  if (closed.status !== "complete") {
    throw new Error("An analytically empty channel must have a complete model")
  }
  expect(closed.intervals).toEqual([])
  expect(closed.sites).toEqual([])
  expect(closed.capacity).toBe(0)
})
