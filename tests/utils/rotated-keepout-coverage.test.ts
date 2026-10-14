import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("unconnected rotated keepouts retain their full area after preprocessing", () => {
  for (const [width, height] of [
    [0.6, 0.2],
    [0.2, 0.6],
    [10, 0.8],
  ]) {
    for (const ccwRotationDegrees of [0, 15, 45, 90, 135, 225, 270, 315]) {
      const srj: SimpleRouteJson = {
        layerCount: 4,
        minTraceWidth: 0.1,
        bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
        obstacles: [
          {
            obstacleId: "keepout_segment",
            type: "rect",
            center: { x: 1, y: -1 },
            width,
            height,
            ccwRotationDegrees,
            layers: ["top", "inner1"],
            connectedTo: [],
          },
        ],
        connections: [],
      }
      const result = addApproximatingRectsToSrj(srj)
      const ccwRotationRadians = (ccwRotationDegrees * Math.PI) / 180
      // Sample the original rectangle, including its boundary. A keepout's
      // electrical connectivity must not change the area it excludes.
      for (let xStep = 0; xStep <= 20; xStep++) {
        for (let yStep = 0; yStep <= 20; yStep++) {
          const x = (xStep / 20 - 0.5) * width
          const y = (yStep / 20 - 0.5) * height
          const point = {
            x: 1 + x * Math.cos(ccwRotationRadians) - y * Math.sin(ccwRotationRadians),
            y: -1 + x * Math.sin(ccwRotationRadians) + y * Math.cos(ccwRotationRadians),
          }
          expect(
            result.obstacles.some(
              (obstacle) =>
                Math.abs(point.x - obstacle.center.x) <=
                  obstacle.width / 2 + 1e-9 &&
                Math.abs(point.y - obstacle.center.y) <=
                  obstacle.height / 2 + 1e-9,
            ),
          ).toBe(true)
        }
      }
      for (const obstacle of result.obstacles) {
        expect(obstacle.ccwRotationDegrees).toBeUndefined()
        expect(obstacle.layers).toEqual(["top", "inner1"])
        expect(obstacle.connectedTo).toEqual([])
      }
    }
  }
})
