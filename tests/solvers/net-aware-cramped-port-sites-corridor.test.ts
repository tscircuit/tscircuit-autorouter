import { expect, test } from "bun:test"
import { getNetAwareCrampedPortSites } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"
import { createNetAwareCrampedCorridor } from "../fixtures/netAwareCrampedPortSites"

test("one net-aware fixed-pitch set recovers a complete owned rectangle corridor", (): void => {
  const input = createNetAwareCrampedCorridor()
  const originalRectangles = structuredClone(input.rectangles)
  const originalNets = new Set(input.routableNetIds)
  const lower = getNetAwareCrampedPortSites(input)
  const upperInput = {
    ...input,
    start: { x: 0.25, y: 0.75 },
    end: { x: 0.75, y: 0.75 },
    existingPoint: { x: 0.5, y: 0.75, z: 0 },
  }
  const upper = getNetAwareCrampedPortSites(upperInput)
  expect(lower.status).toBe("complete")
  expect(upper.status).toBe("complete")
  if (lower.status !== "complete" || upper.status !== "complete") {
    throw new Error("The binary-exact rectangle corridor must be resolved")
  }
  expect(lower.sites).toEqual([
    { index: 0, x: 0.25, y: 0.3125, z: 0, allowedNetIds: ["route-net"] },
    { index: 1, x: 0.25, y: 0.6875, z: 0, allowedNetIds: ["upper-net"] },
  ])
  expect(upper.sites).toEqual([
    { index: 0, x: 0.3125, y: 0.75, z: 0, allowedNetIds: ["upper-net"] },
    { index: 1, x: 0.6875, y: 0.75, z: 0, allowedNetIds: ["route-net"] },
  ])
  expect(lower.capacity).toBe(2)
  expect(upper.capacity).toBe(2)
  for (const edge of [input, upperInput]) {
    expect(
      getNetAwareCrampedPortSites({
        ...edge,
        start: edge.end,
        end: edge.start,
      }),
    ).toEqual(getNetAwareCrampedPortSites(edge))
  }
  const route = [
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0.25, z: 0 },
    lower.sites[0]!,
    upper.sites[1]!,
    { x: 0.75, y: 1, z: 0 },
    { x: 1, y: 1, z: 0 },
  ]
  for (let index = 1; index < route.length; index++) {
    expect(
      input.clearanceIndex.isSegmentClear({
        start: route[index - 1]!,
        end: route[index]!,
        canonicalNetId: "route-net",
        copperDiameter: input.traceWidth,
      }),
    ).toBe(true)
  }
  expect(input.rectangles).toEqual(originalRectangles)
  expect(input.routableNetIds).toEqual(originalNets)
  expect(input.existingPoint).toEqual({ x: 0.25, y: 0.5, z: 0 })
})
