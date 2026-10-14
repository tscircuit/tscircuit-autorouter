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
  test("rejects an obstacle cutting a diagonal whose grid vertices are both clear", () => {
    const r = router([rect(0.5, 0.5)])
    const start = { x: 0, y: 0 }
    const end = { x: 1, y: 1 }
    expect(r.segmentLegal(start, start, 0, 0.05, "net")).toBe(true)
    expect(r.segmentLegal(end, end, 0, 0.05, "net")).toBe(true)
    expect(r.segmentLegal(start, end, 0, 0.05, "net")).toBe(false)
  })

  for (const grid of ["hex", "oct"] as const) {
  }
})
