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

test("addApproximatingRectsToSrj slices slender rotated obstacles into compact rects", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    obstacles: [
      {
        obstacleId: "long_diagonal_obstacle",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 10,
        height: 0.8,
        ccwRotationDegrees: 45,
        connectedTo: [],
      },
    ],
    connections: [],
  }

  const converted = addApproximatingRectsToSrj(srj)

  expect(converted.obstacles.length).toBe(14)
  expect(
    converted.obstacles.every(
      (obstacle) =>
        obstacle.ccwRotationDegrees === undefined &&
        Math.max(obstacle.width, obstacle.height) < 0.9,
    ),
  ).toBe(true)
})

test("rotated-pad approximations conservatively cover the original pad", () => {
  const padWidth = 1.125
  const padHeight = 1.75
  const padRotation = 233
  const padCenter = { x: 0, y: 0 }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -50, minY: -50, maxX: 50, maxY: 50 },
    obstacles: Array.from({ length: 21 }, (_, index) => ({
      obstacleId: `rotated_pad_${index}`,
      type: "rect" as const,
      layers: ["top"],
      center: index === 0 ? padCenter : { x: index * 3, y: 0 },
      width: padWidth,
      height: padHeight,
      ccwRotationDegrees: padRotation,
      connectedTo: [`net_${index}`],
    })),
    connections: [],
  }

  const converted = addApproximatingRectsToSrj(srj)
  const firstPadApproximations = converted.obstacles.filter(
    (obstacle) =>
      obstacle.obstacleId === "rotated_pad_0" ||
      obstacle.obstacleId?.startsWith("rotated_pad_0_approx_"),
  )
  const angleRadians = (padRotation * Math.PI) / 180
  const cosAngle = Math.cos(angleRadians)
  const sinAngle = Math.sin(angleRadians)
  const corners = [-1, 1].flatMap((xSign) =>
    [-1, 1].map((ySign) => {
      const localX = xSign * (padWidth / 2)
      const localY = ySign * (padHeight / 2)
      return {
        x: padCenter.x + localX * cosAngle - localY * sinAngle,
        y: padCenter.y + localX * sinAngle + localY * cosAngle,
      }
    }),
  )

  expect(firstPadApproximations.length).toBeGreaterThan(0)
  expect(firstPadApproximations.length).toBeLessThanOrEqual(6)
  for (const corner of corners) {
    expect(
      firstPadApproximations.some(
        (obstacle) =>
          Math.abs(corner.x - obstacle.center.x) <= obstacle.width / 2 + 1e-9 &&
          Math.abs(corner.y - obstacle.center.y) <= obstacle.height / 2 + 1e-9,
      ),
    ).toBe(true)
  }

  for (let xStep = 0; xStep <= 10; xStep++) {
    for (let yStep = 0; yStep <= 10; yStep++) {
      const localX = (xStep / 10 - 0.5) * padWidth
      const localY = (yStep / 10 - 0.5) * padHeight
      const point = {
        x: padCenter.x + localX * cosAngle - localY * sinAngle,
        y: padCenter.y + localX * sinAngle + localY * cosAngle,
      }

      expect(
        firstPadApproximations.some(
          (obstacle) =>
            Math.abs(point.x - obstacle.center.x) <=
              obstacle.width / 2 + 1e-9 &&
            Math.abs(point.y - obstacle.center.y) <= obstacle.height / 2 + 1e-9,
        ),
      ).toBe(true)
    }
  }
})

/**
 * All the approximating rects should
 * have the same obstacleId as the connected rect
 */
test.skip("addApproximatingRectsToSrj only keeps connectivity on one approximating rect", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    obstacles: [
      {
        obstacleId: "connected_rotated_pad",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        ccwRotationDegrees: 45,
        connectedTo: ["net_a"],
      },
    ],
    connections: [],
  }

  const converted = addApproximatingRectsToSrj(srj)

  expect(
    converted.obstacles.filter((o) => o.connectedTo.length > 0),
  ).toHaveLength(1)
  expect(
    converted.obstacles.filter((o) => o.obstacleId === "connected_rotated_pad"),
  ).toHaveLength(1)
})
