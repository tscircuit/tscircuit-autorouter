import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import {
  addApproximatingRectsToSrj,
  generateApproximatingRects,
} from "lib/utils/addApproximatingRectsToSrj"

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
