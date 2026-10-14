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
  test("connects exact pad positions through legal breakouts rather than snapping the output", () => {
    const terminals = [
      { x: -0.73, y: -0.21, layer: "top", pointId: "a" },
      { x: 0.71, y: 0.28, layer: "top", pointId: "b" },
    ]
    const result = routeDataset(
      {
        bounds,
        layerCount: 2,
        obstacles: [],
        connections: [{ name: "net", width: 0.1, pointsToConnect: terminals }],
      },
      { grid: "oct", pitch: 0.5, clearance: 0.1, timeLimit: 3 },
    )
    expect(result.experiment.completedConnectionNames).toEqual(["net"])
    expect(result.traces).toHaveLength(1)
    const route = result.traces[0].route
    expect(route[0].x).toBe(terminals[0].x)
    expect(route[0].y).toBe(terminals[0].y)
    expect(route.at(-1)!.x).toBe(terminals[1].x)
    expect(route.at(-1)!.y).toBe(terminals[1].y)
  })

  for (const grid of ["hex", "oct"] as const) {
  }
})
