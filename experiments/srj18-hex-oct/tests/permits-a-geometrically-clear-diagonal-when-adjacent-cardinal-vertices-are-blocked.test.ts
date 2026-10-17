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
  test("permits a geometrically clear diagonal when adjacent cardinal vertices are blocked", () => {
    const r = router([rect(0, 1), rect(1, 0)])
    expect(r.segmentLegal({ x: 0, y: 1 }, { x: 0, y: 1 }, 0, 0.05, "net")).toBe(
      false,
    )
    expect(r.segmentLegal({ x: 1, y: 0 }, { x: 1, y: 0 }, 0, 0.05, "net")).toBe(
      false,
    )
    expect(r.segmentLegal({ x: 0, y: 0 }, { x: 1, y: 1 }, 0, 0.05, "net")).toBe(
      true,
    )
  })

  for (const grid of ["hex", "oct"] as const) {
  }
})
