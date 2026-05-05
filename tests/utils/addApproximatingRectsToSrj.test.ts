import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import {
  addApproximatingRectsToSrj,
  generateApproximatingRects,
} from "lib/utils/addApproximatingRectsToSrj"

test("generateApproximatingRects slices long rotated rects along their local long axis", () => {
  const rects = generateApproximatingRects(
    {
      center: { x: 0, y: 0 },
      width: 10,
      height: 0.2,
      rotation: 135,
    },
    14,
  )

  expect(rects).toHaveLength(14)
  for (const rect of rects) {
    expect(Math.max(rect.width, rect.height)).toBeLessThan(1)
    expect(rect.width).toBeCloseTo(rect.height)
    expect(Number.isFinite(rect.center.x)).toBe(true)
    expect(Number.isFinite(rect.center.y)).toBe(true)
  }
})

test("addApproximatingRectsToSrj converts diagonal trace obstacles into small non-rotated rects", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -6, minY: -6, maxX: 6, maxY: 6 },
    obstacles: [
      {
        obstacleId: "trace_obstacle_descending_diagonal",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 10,
        height: 0.2,
        ccwRotationDegrees: 135,
        connectedTo: [],
      },
    ],
    connections: [],
  }

  const converted = addApproximatingRectsToSrj(srj)

  expect(converted.obstacles.length).toBeGreaterThan(2)
  expect(
    converted.obstacles.every(
      (obstacle) =>
        obstacle.ccwRotationDegrees === undefined &&
        Math.max(obstacle.width, obstacle.height) < 1,
    ),
  ).toBe(true)
})
