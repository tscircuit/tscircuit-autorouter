import { describe, expect, test } from "bun:test"
import { createHexGrid } from "../src/hexGrid"
import {
  routeDataset,
  segmentObstacleDistance,
  segmentDistance,
} from "../src/gridRouter"

const bounds = { minX: -5, minY: -5, maxX: 5, maxY: 5 }
describe("hexagonal geometry", () => {
  const grid = createHexGrid(bounds, 0.2)
  test("six equal-length neighbor directions at 60 degree intervals", () => {
    const center = grid.point(13, 9)
    const vectors = grid.directions.map(([di, dj]) => {
      const p = grid.point(13 + di, 9 + dj)
      return { x: p.x - center.x, y: p.y - center.y }
    })
    for (let i = 0; i < vectors.length; i++) {
      const a = vectors[i],
        b = vectors[(i + 1) % vectors.length]
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(0.2, 10)
      expect((a.x * b.x + a.y * b.y) / 0.04).toBeCloseTo(0.5, 10)
    }
  })
})
describe("finite-width physical geometry", () => {})
