import { expect, test } from "bun:test"
import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  type FixedCopperPortalSitesInput,
  getFixedCopperPortalSites,
} from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"

test("portal capacity rejects unsupported cuts missing net domains and invalid physical copper", (): void => {
  const rectangle: FixedCopperRectangle = {
    kind: "fixed-rectangle",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    zLayers: [0],
    ownerNetIds: new Set(["route-net"]),
  }
  const input: FixedCopperPortalSitesInput = {
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
    layerCount: 2,
    zLayers: [0],
    traceWidth: 0.125,
    traceGap: 0.125,
    padGap: 0,
    routableNetIds: new Set(["route-net"]),
    rectangles: [rectangle],
  }
  const changes: Partial<FixedCopperPortalSitesInput>[] = [
    { start: { x: Number.NaN, y: 0 } },
    { end: { x: 1, y: 1 } },
    {
      start: { x: -Number.MAX_VALUE, y: 0 },
      end: { x: Number.MAX_VALUE, y: 0 },
    },
    { layerCount: 0 },
    { layerCount: 1.5 },
    { zLayers: [] },
    { zLayers: [2] },
    { zLayers: [0.5] },
    { routableNetIds: new Set() },
    { routableNetIds: new Set([""]) },
    { traceWidth: 0 },
    { traceWidth: Number.MIN_VALUE },
    { traceWidth: Number.POSITIVE_INFINITY },
    { traceGap: -1 },
    { traceGap: Number.NaN },
    { padGap: -1 },
    { padGap: Number.POSITIVE_INFINITY },
    { traceWidth: Number.MAX_VALUE, traceGap: Number.MAX_VALUE },
  ]
  for (const change of changes) {
    expect((): void => {
      getFixedCopperPortalSites({ ...input, ...change })
    }).toThrow()
  }
  const invalidRectangles: FixedCopperRectangle[] = [
    { ...rectangle, width: 0 },
    { ...rectangle, height: Number.MIN_VALUE },
    { ...rectangle, ccwRotationDegrees: Number.NaN },
    { ...rectangle, center: { x: Number.POSITIVE_INFINITY, y: 0 } },
    { ...rectangle, zLayers: [] },
    { ...rectangle, zLayers: [-1] },
    { ...rectangle, ownerNetIds: new Set([""]) },
    { ...rectangle, kind: "oval" } as unknown as FixedCopperRectangle,
  ]
  for (const invalidRectangle of invalidRectangles) {
    // Even invalid copper owned by a route must not disappear during filtering.
    expect((): void => {
      getFixedCopperPortalSites({ ...input, rectangles: [invalidRectangle] })
    }).toThrow()
  }
})
