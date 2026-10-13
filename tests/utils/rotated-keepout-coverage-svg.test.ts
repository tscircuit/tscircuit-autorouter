import { expect, test } from "bun:test"
import {
  getSvgFromGraphicsObject,
  mergeGraphics,
  translateGraphics,
  type GraphicsObject,
  type Point,
} from "graphics-debug"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("visualizes coverage of a 0.6 by 0.2 mm keepout rotated 45 degrees", async () => {
  const keepout: Obstacle = {
    obstacleId: "keepout_segment",
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.6,
    height: 0.2,
    ccwRotationDegrees: 45,
    layers: ["top"],
    connectedTo: [],
  }
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -0.4, maxX: 0.4, minY: -0.4, maxY: 0.4 },
    obstacles: [keepout],
    connections: [],
  }
  const result = addApproximatingRectsToSrj(srj)
  const angle = Math.PI / 4
  const toWorld = (x: number, y: number): Point => {
    return {
      x: x * Math.cos(angle) - y * Math.sin(angle),
      y: x * Math.sin(angle) + y * Math.cos(angle),
    }
  }
  const sourcePoints: Point[] = []
  for (let xStep = 0; xStep <= 20; xStep++) {
    for (let yStep = 0; yStep <= 20; yStep++) {
      sourcePoints.push(
        toWorld((xStep / 20 - 0.5) * 0.6, (yStep / 20 - 0.5) * 0.2),
      )
    }
  }
  const uncoveredPoints = sourcePoints.filter(
    (point) =>
      !result.obstacles.some(
        (obstacle) =>
          Math.abs(point.x - obstacle.center.x) <=
            obstacle.width / 2 + 1e-9 &&
          Math.abs(point.y - obstacle.center.y) <=
            obstacle.height / 2 + 1e-9,
      ),
  )
  const outline: GraphicsObject = {
    polygons: [
      {
        points: [
          toWorld(-0.3, -0.1),
          toWorld(0.3, -0.1),
          toWorld(0.3, 0.1),
          toWorld(-0.3, 0.1),
        ],
        fill: "transparent",
        stroke: "black",
        strokeWidth: 0.002,
      },
    ],
  }
  const inputGraphics: GraphicsObject = {
    ...outline,
    rects: [{ ...keepout, fill: "rgba(255, 0, 0, 0.25)" }],
    texts: [
      {
        x: 0,
        y: 0.4,
        text: "INPUT: 0.6 x 0.2 mm at 45 deg",
        fontSize: 0.026,
      },
      {
        x: 0,
        y: 0.35,
        text: "Entire outlined area must be blocked",
        fontSize: 0.022,
      },
    ],
  }
  const outputGraphics: GraphicsObject = {
    ...outline,
    rects: result.obstacles.map((obstacle) => ({
      ...obstacle,
      fill: "rgba(255, 0, 0, 0.25)",
      stroke: "red",
    })),
    circles: uncoveredPoints.map((point) => ({
      center: point,
      radius: 0.004,
      fill: "#e07600",
    })),
    texts: [
      {
        x: 0,
        y: 0.4,
        text: "AFTER OBSTACLE PREPROCESSING",
        fontSize: 0.026,
      },
      {
        x: 0,
        y: 0.35,
        text: `${uncoveredPoints.length}/${sourcePoints.length} points uncovered (orange)`,
        fontSize: 0.022,
      },
    ],
  }

  await expect(
    getSvgFromGraphicsObject(
      mergeGraphics(inputGraphics, translateGraphics(outputGraphics, 0.85, 0)),
      {
        backgroundColor: "white",
        svgWidth: 1200,
        svgHeight: 600,
        hideInlineLabels: true,
      },
    ).replace(/[ \t]+$/gm, ""),
  ).toMatchSvgSnapshot(import.meta.path)
})
