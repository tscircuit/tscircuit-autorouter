import { describe, expect, test } from "bun:test"
import { GridRouter, routeDataset, segmentObstacleDistance } from "../src/gridRouter"

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

  test("checks a through via against inner copper layers", () => {
    const r = router([rect(0, 0, "inner1")], 4)
    const p = { x: 0, y: 0 }
    expect(r.segmentLegal(p, p, 0, 0.15, "net")).toBe(true)
    expect(r.segmentLegal(p, p, 3, 0.15, "net")).toBe(true)
    expect(r.viaLegal(p, "net")).toBe(false)
  })

  for (const grid of ["hex", "oct"] as const) {
  }
})
