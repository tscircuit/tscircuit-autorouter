import { expect, test } from "bun:test"
import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  type FixedCopperPortalSitesInput,
  getFixedCopperPortalSites,
} from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"

test("portal capacity leaves shared rectangles cut endpoints layers and owners unchanged", (): void => {
  const rectangle = Object.freeze<FixedCopperRectangle>({
    kind: "fixed-rectangle",
    center: Object.freeze({ x: 0.5, y: 0 }),
    width: 0.25,
    height: 1,
    zLayers: Object.freeze([1, 0]),
    ownerNetIds: new Set(["fixed-net"]),
  })
  const input = Object.freeze<FixedCopperPortalSitesInput>({
    start: Object.freeze({ x: 1, y: 0 }),
    end: Object.freeze({ x: 0, y: 0 }),
    layerCount: 2,
    zLayers: Object.freeze([1, 0, 1]),
    traceWidth: 0.125,
    traceGap: 0.125,
    padGap: 0.0625,
    routableNetIds: new Set(["route-b", "route-a"]),
    rectangles: Object.freeze([rectangle]),
  })
  const before = structuredClone(input)
  const result = getFixedCopperPortalSites(input)
  expect(input).toEqual(before)
  expect(result.start).not.toBe(input.end)
  expect(result.end).not.toBe(input.start)
  expect(result.layers.map((layer): number => layer.z)).toEqual([0, 1])
  expect(getFixedCopperPortalSites(input)).toEqual(result)
  expect(input).toEqual(before)
})
