import { expect, test } from "bun:test"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { createNetAwareCrampedCorridor } from "../fixtures/netAwareCrampedPortSites"

test("different net channels share one edge spacing budget rather than independent aliases", (): void => {
  const input = createNetAwareCrampedCorridor()
  const result = getNetAwareCrampedPortSites({ ...input, traceGap: 0.5 })
  expect(result.status).toBe("complete")
  if (result.status !== "complete") {
    throw new Error("The separated binary-exact channels must be resolved")
  }
  expect(result.intervals).toEqual([
    { start: 0.25, end: 0.46875 },
    { start: 0.53125, end: 0.75 },
  ])
  expect(result.pitch).toBe(0.75)
  expect(result.capacity).toBe(1)
  expect(result.sites).toEqual([
    { index: 0, x: 0.25, y: 0.359375, z: 0, allowedNetIds: ["route-net"] },
  ])
  // Count packing intentionally does not promise coverage of every legal net.
  expect(
    result.netClasses.find((entry): boolean =>
      entry.netIds.includes("upper-net"),
    )?.intervals,
  ).toEqual([{ start: 0.53125, end: 0.75 }])
})
