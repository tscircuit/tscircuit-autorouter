import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"

test("fixed copper segment clearance rejects a blocked interior despite legal endpoints", (): void => {
  const index = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        zLayers: [1],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.25,
  })
  const start = { x: -2, y: 0, z: 1 }
  const end = { x: 2, y: 0, z: 1 }
  for (const point of [start, end]) {
    expect(
      index.isPointClear({
        point,
        canonicalNetId: "route-net",
        copperDiameter: 0.5,
      }),
    ).toBeTrue()
  }
  expect(
    index.isSegmentClear({
      start,
      end,
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
    }),
  ).toBeFalse()
  expect(
    index.isSegmentClear({
      start,
      end,
      canonicalNetId: "pad-net",
      copperDiameter: 0.5,
    }),
  ).toBeTrue()

  // Legal endpoints can still cut the rounded clearance region at a corner
  // without intersecting the pad rectangle itself.
  const cornerStart = { x: 1.6, y: 1, z: 1 }
  const cornerEnd = { x: 1, y: 1.6, z: 1 }
  const cornerBend = { x: 1.6, y: 1.6, z: 1 }
  for (const point of [cornerStart, cornerEnd]) {
    expect(
      index.isPointClear({
        point,
        canonicalNetId: "route-net",
        copperDiameter: 0.5,
      }),
    ).toBeTrue()
  }
  expect(
    index.isSegmentClear({
      start: cornerStart,
      end: cornerEnd,
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
    }),
  ).toBeFalse()
  for (const point of [cornerStart, cornerEnd]) {
    expect(
      index.isSegmentClear({
        start: point,
        end: cornerBend,
        canonicalNetId: "route-net",
        copperDiameter: 0.5,
      }),
    ).toBeTrue()
  }
  for (const y of [1.5, 1.49]) {
    expect(
      index.isSegmentClear({
        start: { x: -2, y, z: 1 },
        end: { x: 2, y, z: 1 },
        canonicalNetId: "route-net",
        copperDiameter: 0.5,
      }),
    ).toBe(y === 1.5)
  }
  const point = { x: 0, y: 0, z: 1 }
  expect(
    index.isSegmentClear({
      start: point,
      end: point,
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
    }),
  ).toBeFalse()
  expect(
    index.isSegmentClear({
      start,
      end: start,
      canonicalNetId: "route-net",
      copperDiameter: 0.5,
    }),
  ).toBeTrue()
})
