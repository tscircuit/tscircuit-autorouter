import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"

test("fixed-copper fingerprints preserve exact immutable geometry and normalize only ordering", (): void => {
  const center = { x: 0, y: 0 }
  const layers = [1, 0]
  const owners = new Set(["owner-b", "owner-a"])
  const rectangle: FixedCopperRectangle = {
    kind: "fixed-rectangle",
    center,
    width: 1,
    height: 0.5,
    zLayers: layers,
    ownerNetIds: owners,
  }
  const other: FixedCopperRectangle = {
    ...rectangle,
    center: { x: 3, y: 2 },
    ownerNetIds: new Set(["owner-c"]),
  }
  const original = new FixedCopperClearanceIndex({
    rectangles: [rectangle, other],
    layerCount: 2,
    minClearance: 0.1,
  })
  const equivalent = new FixedCopperClearanceIndex({
    rectangles: [
      { ...other, zLayers: [0, 1] },
      {
        ...rectangle,
        center: { x: 0, y: 0 },
        ccwRotationDegrees: 360,
        zLayers: [0, 1, 0],
        ownerNetIds: new Set(["owner-a", "owner-b"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.1,
  })
  expect(original.cacheFingerprint).toMatch(/^[a-f0-9]{40}$/)
  expect(equivalent.cacheFingerprint).toBe(original.cacheFingerprint)

  const changedRectangles: FixedCopperRectangle[] = [
    { ...rectangle, center: { x: 0.0001, y: 0 } },
    { ...rectangle, center: { x: 0, y: 0.0001 } },
    { ...rectangle, width: 1.0001 },
    { ...rectangle, height: 0.5001 },
    { ...rectangle, ccwRotationDegrees: 0.0001 },
    { ...rectangle, zLayers: [0] },
    { ...rectangle, ownerNetIds: new Set(["owner-a"]) },
  ]
  for (const changed of changedRectangles) {
    const index = new FixedCopperClearanceIndex({
      rectangles: [changed, other],
      layerCount: 2,
      minClearance: 0.1,
    })
    expect(index.cacheFingerprint).not.toBe(original.cacheFingerprint)
  }
  for (const rule of [
    { layerCount: 3, minClearance: 0.1 },
    { layerCount: 2, minClearance: 0.1001 },
    { layerCount: 2, minClearance: 0 },
  ]) {
    const index = new FixedCopperClearanceIndex({
      rectangles: [rectangle, other],
      ...rule,
    })
    expect(index.cacheFingerprint).not.toBe(original.cacheFingerprint)
  }

  const fingerprint = original.cacheFingerprint
  center.x = 10
  layers.splice(0, layers.length, 1)
  owners.add("foreign")
  expect(original.cacheFingerprint).toBe(fingerprint)
  expect(
    original.isPointClear({
      point: { x: 0, y: 0, z: 0 },
      canonicalNetId: "foreign",
      copperDiameter: 0.15,
    }),
  ).toBeFalse()
})
