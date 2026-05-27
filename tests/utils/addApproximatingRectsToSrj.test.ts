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

test("addApproximatingRectsToSrj only keeps connectivity on one approximating rect", () => {
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
  expect(
    converted.obstacles.filter(
      (o) => o.parentObstacleId === "connected_rotated_pad",
    ),
  ).toHaveLength(converted.obstacles.length - 1)
})

test("addApproximatingRectsToSrj promotes the endpoint-containing child to the parent obstacle", () => {
  const approximatingRects = generateApproximatingRects(
    {
      center: { x: 0, y: 0 },
      width: 6,
      height: 0.2,
      rotation: 135,
    },
    8,
  )
  const targetRect = approximatingRects[approximatingRects.length - 1]!
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    obstacles: [
      {
        obstacleId: "trace_obstacle_connected",
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 6,
        height: 0.2,
        ccwRotationDegrees: 135,
        connectedTo: ["net_a"],
      },
    ],
    connections: [
      {
        name: "net_a",
        pointsToConnect: [
          {
            x: targetRect.center.x,
            y: targetRect.center.y,
            layer: "top",
          },
          {
            x: -4,
            y: -4,
            layer: "top",
          },
        ],
      },
    ],
  }

  const converted = addApproximatingRectsToSrj(srj)
  const parentObstacle = converted.obstacles.find(
    (obstacle) => obstacle.obstacleId === "trace_obstacle_connected",
  )

  expect(parentObstacle).toBeDefined()
  expect(parentObstacle?.center.x).toBeCloseTo(targetRect.center.x)
  expect(parentObstacle?.center.y).toBeCloseTo(targetRect.center.y)
  expect(parentObstacle?.connectedTo).toEqual(["net_a"])
  expect(
    converted.obstacles.some(
      (obstacle) =>
        obstacle.parentObstacleId === "trace_obstacle_connected" &&
        obstacle.connectedTo.length === 0,
    ),
  ).toBe(true)
})

test("addApproximatingRectsToSrj synthesizes a parent obstacle id for connected rotated obstacles without ids", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0 },
        width: 3.2,
        height: 1.25,
        ccwRotationDegrees: 45,
        connectedTo: ["source_trace_0", "pcb_port_0"],
      },
    ],
    connections: [
      {
        name: "source_trace_0",
        pointsToConnect: [
          {
            x: 0.25,
            y: 0.25,
            layer: "top",
            pointId: "pcb_port_0",
            pcb_port_id: "pcb_port_0",
          },
          {
            x: 3,
            y: 3,
            layer: "top",
          },
        ],
      },
    ],
  }

  const converted = addApproximatingRectsToSrj(srj)
  const parentObstacle = converted.obstacles.find(
    (obstacle) => obstacle.connectedTo.length > 0,
  )

  expect(parentObstacle?.obstacleId).toBe("connected_obstacle_0")
  expect(
    converted.obstacles.some(
      (obstacle) => obstacle.parentObstacleId === "connected_obstacle_0",
    ),
  ).toBe(true)
})
