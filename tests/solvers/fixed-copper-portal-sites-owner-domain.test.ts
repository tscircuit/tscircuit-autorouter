import { expect, test } from "bun:test"
import {
  type FixedCopperPortalSitesInput,
  getFixedCopperPortalSites,
} from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"

test("shared portal capacity includes only copper foreign to every actual route net", (): void => {
  const input: FixedCopperPortalSitesInput = {
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    layerCount: 1,
    zLayers: [0],
    traceWidth: 0.125,
    traceGap: 0.125,
    padGap: 0,
    routableNetIds: new Set(["route-b", "route-a"]),
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0.5, y: 0 },
        width: 4,
        height: 4,
        zLayers: [0],
        ownerNetIds: new Set(["route-a", "another-owner"]),
      },
    ],
  }
  // The shared resource is optimistic: route-b still needs its own native
  // reservation check, while route-a may legitimately land on its own copper.
  expect(getFixedCopperPortalSites(input).totalCapacity).toBe(5)
  expect(
    getFixedCopperPortalSites({
      ...input,
      routableNetIds: new Set(["route-b"]),
    }).totalCapacity,
  ).toBe(0)
  expect(
    getFixedCopperPortalSites({
      ...input,
      rectangles: [{ ...input.rectangles[0]!, ownerNetIds: new Set() }],
    }).totalCapacity,
  ).toBe(0)
})
