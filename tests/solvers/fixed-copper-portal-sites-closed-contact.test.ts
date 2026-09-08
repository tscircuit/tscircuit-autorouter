import { expect, test } from "bun:test"
import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  type FixedCopperPortalSitesInput,
  getFixedCopperPortalSites,
} from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"

test("exact clearance contacts and a legal singleton cut retain their physical site", (): void => {
  const input: FixedCopperPortalSitesInput = {
    start: { x: 0, y: -1 },
    end: { x: 0, y: 1 },
    layerCount: 1,
    zLayers: [0],
    traceWidth: 0.25,
    traceGap: 0.25,
    padGap: 0.125,
    routableNetIds: new Set(["route-net"]),
    rectangles: [-1, 1].map((y): FixedCopperRectangle => ({
      kind: "fixed-rectangle",
      center: { x: 0, y },
      width: 1,
      height: 1.5,
      zLayers: [0],
      ownerNetIds: new Set(["pad-net"]),
    })),
  }
  const result = getFixedCopperPortalSites(input)
  expect(result.axis).toBe("y")
  expect(result.layers[0]!.intervals).toEqual([{ start: 0, end: 0 }])
  expect(result.layers[0]!.sites).toEqual([{ index: 0, x: 0, y: 0 }])
  expect(result.totalCapacity).toBe(1)
  expect(
    getFixedCopperPortalSites({ ...input, start: input.end, end: input.start }),
  ).toEqual(result)
  const singleton = getFixedCopperPortalSites({
    ...input,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
  })
  expect(singleton.totalCapacity).toBe(1)
  expect(singleton.layers[0]!.sites).toEqual(result.layers[0]!.sites)
})
