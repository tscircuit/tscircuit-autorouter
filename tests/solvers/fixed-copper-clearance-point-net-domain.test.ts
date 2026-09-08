import { expect, test } from "bun:test"
import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"

test("point net domains intersect actual overlapping copper owners in one spatial query", (): void => {
  const first: FixedCopperRectangle = {
    kind: "fixed-rectangle",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    zLayers: [0],
    ownerNetIds: new Set(["net-a", "net-b"]),
  }
  const second: FixedCopperRectangle = {
    ...first,
    ownerNetIds: new Set(["net-b"]),
  }
  for (const rectangles of [[first, second], [second, first]]) {
    const index = new FixedCopperClearanceIndex({
      rectangles,
      layerCount: 2,
      minClearance: 0.125,
    })
    const query = {
      point: { x: 0, y: 0, z: 0 },
      copperDiameter: 0.25,
    }
    expect(index.getAllowedNetIdsAtPoint(query)).toEqual(new Set(["net-b"]))
    for (const canonicalNetId of ["net-a", "net-b", "net-c"]) {
      expect(index.isPointClear({ ...query, canonicalNetId })).toBe(
        canonicalNetId === "net-b",
      )
    }
    expect(
      index.getAllowedNetIdsAtPoint({
        ...query,
        point: { x: 1.25, y: 0, z: 0 },
      }),
    ).toBeNull()
    expect(
      index.getAllowedNetIdsAtPoint({
        ...query,
        point: { x: 0, y: 0, z: 1 },
      }),
    ).toBeNull()
    expect(
      index.getAllowedNetIdsAtPoint({
        point: { x: 1.25, y: 0, z: 0 },
        copperDiameter: 0.5,
      }),
    ).toEqual(new Set(["net-b"]))
  }
  const incompatible = new FixedCopperClearanceIndex({
    rectangles: [first, { ...second, ownerNetIds: new Set(["net-c"]) }],
    layerCount: 2,
    minClearance: 0.125,
  })
  expect(
    incompatible.getAllowedNetIdsAtPoint({
      point: { x: 0, y: 0, z: 0 },
      copperDiameter: 0.25,
    }),
  ).toEqual(new Set())
})
