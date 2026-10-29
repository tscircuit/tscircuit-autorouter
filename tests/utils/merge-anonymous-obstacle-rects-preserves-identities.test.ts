import { expect, test } from "bun:test"
import type { Obstacle } from "lib/types"
import { mergeAnonymousObstacleRects } from "lib/utils/mergeAnonymousObstacleRects"

test("merging preserves pad identities, holes, rotations and layer membership", () => {
  const rect: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: [],
  }
  const protectedRects: Obstacle[] = [
    { ...rect, obstacleId: "keepout" },
    { ...rect, componentId: "component" },
    { ...rect, connectedTo: ["net"] },
    { ...rect, isNonPlatedHole: true },
    { ...rect, ccwRotationDegrees: 45 },
    { ...rect, shape: "circle" },
  ]
  const input: Obstacle[] = [
    ...protectedRects,
    rect,
    { ...rect, center: { x: 1, y: 0 } },
    { ...rect, center: { x: 2, y: 0 }, layers: ["bottom"] },
  ]
  const result = mergeAnonymousObstacleRects(input)
  for (const original of protectedRects) {
    expect(result.some((obstacle): boolean => obstacle === original)).toBe(true)
  }
  expect(result).toHaveLength(protectedRects.length + 2)
  expect(
    result.find((obstacle): boolean => obstacle.width === 2)?.layers,
  ).toEqual(["top"])
  expect(input).toHaveLength(protectedRects.length + 3)
})
