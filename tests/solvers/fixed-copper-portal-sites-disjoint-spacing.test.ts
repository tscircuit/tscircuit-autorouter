import { expect, test } from "bun:test"
import { getFixedCopperPortalSites } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"

test("portal packing carries physical spacing across disjoint legal intervals", (): void => {
  const result = getFixedCopperPortalSites({
    start: { x: 0, y: 0 },
    end: { x: 2.25, y: 0 },
    layerCount: 1,
    zLayers: [0],
    traceWidth: 0.125,
    traceGap: 0.875,
    padGap: 0,
    routableNetIds: new Set(["route-net"]),
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 1.125, y: 0 },
        width: 0.125,
        height: 1,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
  })
  expect(result.layers[0]!.intervals).toEqual([
    { start: 0, end: 1 },
    { start: 1.25, end: 2.25 },
  ])
  // Counting each interval separately would claim four incompatible sites.
  expect(result.layers[0]!.sites).toEqual([
    { index: 0, x: 0, y: 0 },
    { index: 1, x: 1, y: 0 },
    { index: 2, x: 2, y: 0 },
  ])
  expect(result.totalCapacity).toBe(3)
})
