import { expect, test } from "bun:test"
import {
  type FixedCopperPortalSitesInput,
  getFixedCopperPortalSites,
} from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"

test("an asymmetric two-layer cut provides four plus three physical lanes independent of orientation", (): void => {
  const input: FixedCopperPortalSitesInput = {
    start: { x: -1, y: 0 },
    end: { x: 1, y: 0 },
    layerCount: 2,
    zLayers: [1, 0, 1],
    traceWidth: 0.125,
    traceGap: 0.125,
    padGap: 0.0625,
    routableNetIds: new Set(["route-a", "route-b"]),
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: -1, y: 0 },
        width: 1,
        height: 1,
        zLayers: [0],
        ownerNetIds: new Set(["pad-left"]),
      },
      {
        kind: "fixed-rectangle",
        center: { x: 1, y: 0 },
        width: 1,
        height: 1,
        zLayers: [0],
        ownerNetIds: new Set(["pad-right"]),
      },
      {
        kind: "fixed-rectangle",
        center: { x: -1, y: 0 },
        width: 1.25,
        height: 1,
        zLayers: [1],
        ownerNetIds: new Set(["pad-left"]),
      },
      {
        kind: "fixed-rectangle",
        center: { x: 1, y: 0 },
        width: 1.25,
        height: 1,
        zLayers: [1],
        ownerNetIds: new Set(["pad-right"]),
      },
    ],
  }
  const result = getFixedCopperPortalSites(input)
  expect(result.pitch).toBe(0.25)
  expect(result.layers.map((layer): number => layer.capacity)).toEqual([4, 3])
  expect(result.totalCapacity).toBe(7)
  expect(result.layers[0]!.intervals).toEqual([{ start: -0.375, end: 0.375 }])
  expect(result.layers[1]!.intervals).toEqual([{ start: -0.25, end: 0.25 }])
  expect(result.layers[0]!.sites.map((site): number => site.x)).toEqual([
    -0.375, -0.125, 0.125, 0.375,
  ])
  expect(result.layers[1]!.sites.map((site): number => site.x)).toEqual([
    -0.25, 0, 0.25,
  ])
  expect(
    getFixedCopperPortalSites({
      ...input,
      start: input.end,
      end: input.start,
      zLayers: [0, 1],
    }),
  ).toEqual(result)
})
