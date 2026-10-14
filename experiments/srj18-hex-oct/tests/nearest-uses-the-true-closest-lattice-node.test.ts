import { describe, expect, test } from "bun:test"
import { createHexGrid } from "../src/hexGrid"
import { routeDataset, segmentObstacleDistance, segmentDistance } from "../src/gridRouter"

const bounds = { minX: -5, minY: -5, maxX: 5, maxY: 5 }
describe("hexagonal geometry", () => {
  const grid = createHexGrid(bounds, 0.2)
  test("nearest uses the true closest lattice node", () => {
    for (let i = 0; i < 31; i++) {
      const x = -4.3 + i * 0.0937, y = -2.4 + i * 0.0713, [q, r] = grid.nearest(x, y), p = grid.point(q, r)
      const chosen = Math.hypot(x - p.x, y - p.y)
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) { const other = grid.point(q + di, r + dj); expect(chosen).toBeLessThanOrEqual(Math.hypot(x - other.x, y - other.y) + 1e-10) }
    }
  })
})
describe("finite-width physical geometry", () => {
})
