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
  for (const grid of ["oct"] as const) {
    test(`${grid} detour output clears foreign obstacles and committed copper along every moving segment`, () => {
      const terminals = [
        { x: -1.43, y: 0.11, layer: "top", pointId: "a" },
        { x: 1.41, y: 0.11, layer: "top", pointId: "b" },
      ]
      const input = {
        bounds,
        layerCount: 4,
        obstacles: [{ ...rect(0, 0), width: 0.45, height: 0.45 }],
        connections: [{ name: "net", width: 0.1, pointsToConnect: terminals }],
      }
      const r = new GridRouter(input, {
        grid,
        pitch: 0.2,
        clearance: 0.1,
        timeLimit: 3,
        viaPenalty: 2,
      })
      r.addCopper({
        net: "foreign-copper",
        a: { x: 0.65, y: -0.45 },
        b: { x: 0.65, y: 0.6 },
        radius: 0.08,
        layers: [0],
      })
      const net = r.union.find("net")
      // The direct pad-to-pad edge is physically illegal, so this must detour.
      expect(r.segmentLegal(terminals[0], terminals[1], 0, 0.05, net)).toBe(
        false,
      )
      const result = r.run()
      expect(result.experiment.completedConnectionNames).toEqual(["net"])
      expect(result.traces).toHaveLength(1)
      const route = result.traces[0].route
      let movingSegments = 0
      let outputLength = 0
      for (const [index, point] of route.entries()) {
        if (point.route_type === "via") {
          expect(r.viaLegal(point, net)).toBe(true)
          for (let layer = 0; layer < r.layers.length; layer++) {
            expect(
              r.segmentLegal(
                point,
                point,
                layer,
                point.outer_diameter / 2,
                net,
              ),
            ).toBe(true)
          }
        }
        if (index === 0) continue
        const previous = route[index - 1]
        const length = Math.hypot(point.x - previous.x, point.y - previous.y)
        if (length < 1e-8) continue
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
        outputLength += length
      }
      expect(movingSegments).toBeGreaterThanOrEqual(2)
      expect(outputLength).toBeGreaterThan(
        Math.hypot(
          terminals[1].x - terminals[0].x,
          terminals[1].y - terminals[0].y,
        ) + 1e-5,
      )
    })
  }
})
