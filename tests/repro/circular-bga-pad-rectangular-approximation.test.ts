import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

type CircularObstacle = Obstacle & { shape: "circle" }

test("repro: circular BGA pads retain square corner obstacles", (): void => {
  const padDiameter = 0.5
  const pitch = 0.8
  const circularPads: CircularObstacle[] = []

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      circularPads.push({
        obstacleId: `bga-pad-${row}-${column}`,
        componentId: "U1",
        type: "rect",
        shape: "circle",
        layers: ["top"],
        center: { x: column * pitch, y: row * pitch },
        width: padDiameter,
        height: padDiameter,
        connectedTo: [`U1-${row}-${column}`],
      })
    }
  }

  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    bounds: { minX: -1, minY: -1, maxX: 3, maxY: 3 },
    obstacles: circularPads,
    connections: [],
  }

  const preprocessed = addApproximatingRectsToSrj(input)
  const firstPad = preprocessed.obstacles.find(
    (obstacle) => obstacle.obstacleId === "bga-pad-0-0",
  )!
  const pointInsideSquareButOutsideCircle = {
    x: firstPad.center.x + padDiameter * 0.49,
    y: firstPad.center.y + padDiameter * 0.49,
  }
  const isBlockedByRectApproximation =
    Math.abs(pointInsideSquareButOutsideCircle.x - firstPad.center.x) <=
      firstPad.width / 2 &&
    Math.abs(pointInsideSquareButOutsideCircle.y - firstPad.center.y) <=
      firstPad.height / 2
  const distanceFromCircleCenter = Math.hypot(
    pointInsideSquareButOutsideCircle.x - firstPad.center.x,
    pointInsideSquareButOutsideCircle.y - firstPad.center.y,
  )

  expect(preprocessed.obstacles).toHaveLength(9)
  expect(isBlockedByRectApproximation).toBe(true)
  expect(distanceFromCircleCenter).toBeGreaterThan(padDiameter / 2)

  const visualization: GraphicsObject = {
    title: "Circular BGA pads retained as rectangular obstacles",
    rects: preprocessed.obstacles.map((obstacle) => ({
      center: obstacle.center,
      width: obstacle.width,
      height: obstacle.height,
      fill: "rgba(255, 0, 0, 0.2)",
      stroke: "red",
      label: `${obstacle.obstacleId} rectangular obstacle`,
    })),
    circles: [
      ...circularPads.map((pad) => ({
        center: pad.center,
        radius: padDiameter / 2,
        fill: "rgba(0, 120, 255, 0.2)",
        stroke: "blue",
        label: `${pad.obstacleId} actual circle`,
      })),
      {
        center: pointInsideSquareButOutsideCircle,
        radius: 0.04,
        fill: "red",
        stroke: "red",
        label: "falsely blocked square corner",
      },
    ],
  }

  expect(visualization).toMatchGraphicsSvg(import.meta.path)
})
