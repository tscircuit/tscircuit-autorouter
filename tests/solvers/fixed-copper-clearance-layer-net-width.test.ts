import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"

test("fixed copper clearance uses actual layer net and width without retaining mutable inputs", (): void => {
  const center = { x: 0, y: 0 }
  const layers = [0, 2]
  const ownerNetIds = new Set(["first-owner", "second-owner"])
  const rectangle: FixedCopperRectangle = {
    kind: "fixed-rectangle",
    center,
    width: 2,
    height: 2,
    zLayers: layers,
    ownerNetIds,
  }
  const originalRectangle = structuredClone(rectangle)
  const index = new FixedCopperClearanceIndex({
    rectangles: [rectangle],
    layerCount: 4,
    minClearance: 0.125,
  })
  for (const canonicalNetId of ["first-owner", "second-owner"]) {
    expect(
      index.isPointClear({
        point: { x: 0, y: 0, z: 0 },
        canonicalNetId,
        copperDiameter: 0.5,
      }),
    ).toBeTrue()
  }
  for (const z of [0, 1, 2, 3]) {
    expect(
      index.isPointClear({
        point: { x: 0, y: 0, z },
        canonicalNetId: "foreign-net",
        copperDiameter: 0.5,
      }),
    ).toBe(z === 1 || z === 3)
  }
  const point = { x: 1.375, y: 0, z: 2 }
  for (const copperDiameter of [0.25, 0.75, 0.25]) {
    expect(
      index.isPointClear({
        point,
        canonicalNetId: "foreign-net",
        copperDiameter,
      }),
    ).toBe(copperDiameter === 0.25)
  }
  expect(point).toEqual({ x: 1.375, y: 0, z: 2 })
  expect(rectangle).toEqual(originalRectangle)

  const foreignRectangle: FixedCopperRectangle = {
    ...rectangle,
    center: { x: 0.5, y: 0 },
    ownerNetIds: new Set(["foreign-pad-net"]),
  }
  for (const rectangles of [
    [rectangle, foreignRectangle],
    [foreignRectangle, rectangle],
  ]) {
    const overlapIndex = new FixedCopperClearanceIndex({
      rectangles,
      layerCount: 4,
      minClearance: 0.125,
    })
    expect(
      overlapIndex.isPointClear({
        point: { x: 0, y: 0, z: 2 },
        canonicalNetId: "second-owner",
        copperDiameter: 0.5,
      }),
    ).toBeFalse()
  }

  center.x = 100
  layers.splice(0, layers.length, 1)
  ownerNetIds.clear()
  ownerNetIds.add("foreign-net")
  expect(
    index.isPointClear({
      point: { x: 0, y: 0, z: 2 },
      canonicalNetId: "foreign-net",
      copperDiameter: 0.5,
    }),
  ).toBeFalse()
  expect(
    index.isPointClear({
      point: { x: 0, y: 0, z: 0 },
      canonicalNetId: "second-owner",
      copperDiameter: 0.5,
    }),
  ).toBeTrue()
})
