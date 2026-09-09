import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"

test("fixed copper clearance rejects invalid geometry layers and unrepresentable positive copper", (): void => {
  const rectangle: FixedCopperRectangle = {
    kind: "fixed-rectangle",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    zLayers: [0],
    ownerNetIds: new Set(["pad-net"]),
  }
  const invalidRectangles: FixedCopperRectangle[] = [
    { ...rectangle, center: { x: Number.NaN, y: 0 } },
    { ...rectangle, width: Number.POSITIVE_INFINITY },
    { ...rectangle, height: 0 },
    { ...rectangle, width: Number.MIN_VALUE },
    { ...rectangle, height: Number.MIN_VALUE },
    { ...rectangle, ccwRotationDegrees: Number.NaN },
    { ...rectangle, zLayers: [] },
    { ...rectangle, zLayers: [2] },
    { ...rectangle, zLayers: [0.5] },
    { ...rectangle, ownerNetIds: new Set([""]) },
  ]
  for (const invalidRectangle of invalidRectangles) {
    expect((): void => {
      new FixedCopperClearanceIndex({
        rectangles: [invalidRectangle],
        layerCount: 2,
        minClearance: 0,
      })
    }).toThrow("FixedCopperClearanceIndex")
  }
  for (const minClearance of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect((): void => {
      new FixedCopperClearanceIndex({
        rectangles: [rectangle],
        layerCount: 2,
        minClearance,
      })
    }).toThrow("finite nonnegative clearance")
  }
  const index = new FixedCopperClearanceIndex({
    rectangles: [rectangle],
    layerCount: 2,
    minClearance: 0,
  })
  for (const copperDiameter of [0, -1, Number.NaN, Number.MIN_VALUE]) {
    expect((): void => {
      index.isPointClear({
        point: { x: 0, y: 0, z: 0 },
        canonicalNetId: "route-net",
        copperDiameter,
      })
    }).toThrow("FixedCopperClearanceIndex")
  }
  expect((): void => {
    index.isSegmentClear({
      start: { x: 0, y: 0, z: 0 },
      end: { x: 1, y: 0, z: 1 },
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
    })
  }).toThrow("same-layer segment")
  expect((): void => {
    index.isPointClear({
      point: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
    })
  }).toThrow("finite physical point coordinates")
  expect((): void => {
    index.isPointClear({
      point: { x: 0, y: 0, z: -1 },
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
    })
  }).toThrow("invalid layer")
})
