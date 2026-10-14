import { describe, expect, test } from "bun:test"
import {
  GridRouter,
  routeDataset,
  segmentObstacleDistance,
} from "../src/gridRouter"

const bounds = { minX: -2, minY: -2, maxX: 2, maxY: 2 }
const rect = (x: number, y: number, layer = "top") => ({
  type: "rect",
  center: { x, y },
  width: 0.1,
  height: 0.1,
  layers: [layer],
})
const router = (obstacles: ReturnType<typeof rect>[] = [], layerCount = 2) =>
  new GridRouter(
    { bounds, layerCount, obstacles, connections: [] },
    { grid: "oct", pitch: 1, clearance: 0.1, timeLimit: 3 },
  )

describe("octagonal routing physical geometry", () => {
  for (const grid of ["hex"] as const) {
    test(`${grid} layer changes emit a through via clearing every copper layer`, () => {
      const r = new GridRouter(
        {
          bounds,
          layerCount: 4,
          obstacles: [{ ...rect(0, 0, "inner1"), width: 0.5, height: 0.5 }],
          connections: [
            {
              name: "net",
              width: 0.1,
              pointsToConnect: [
                { x: -1.17, y: 0.13, layer: "top", pointId: "a" },
                { x: 1.21, y: 0.13, layer: "bottom", pointId: "b" },
              ],
            },
          ],
        },
        { grid, pitch: 0.2, clearance: 0.1, timeLimit: 3 },
      )
      const result = r.run()
      expect(result.experiment.completedConnectionNames).toEqual(["net"])
      const route = result.traces[0].route
      const vias = route.filter((point) => point.route_type === "via")
      expect(vias.length).toBeGreaterThanOrEqual(1)
      const net = r.union.find("net")
      for (const via of vias) {
        expect(r.viaLegal(via, net)).toBe(true)
        for (let layer = 0; layer < r.layers.length; layer++) {
          expect(
            r.segmentLegal(via, via, layer, via.outer_diameter / 2, net),
          ).toBe(true)
        }
      }
      let movingSegments = 0
      for (let index = 1; index < route.length; index++) {
        const previous = route[index - 1]
        const point = route[index]
        if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1e-8)
          continue
        const layerName =
          point.route_type === "wire" ? point.layer : point.from_layer
        const previousLayer =
          previous.route_type === "wire" ? previous.layer : previous.to_layer
        expect(previousLayer).toBe(layerName)
        expect(
          r.segmentLegal(
            previous,
            point,
            r.layers.indexOf(layerName),
            0.05,
            net,
          ),
        ).toBe(true)
        movingSegments++
      }
      expect(movingSegments).toBeGreaterThan(0)
    })
  }
})
