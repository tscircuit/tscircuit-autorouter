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
  test("graph distance agrees with an independent breadth first search", () => {
    const queue = [[0, 0, 0]],
      reached = new Map<string, number>([["0,0", 0]])
    for (let k = 0; k < queue.length; k++) {
      const [i, j, distance] = queue[k]
      if (distance >= 8) continue
      for (const [di, dj] of grid.directions) {
        const key = `${i + di},${j + dj}`
        if (!reached.has(key)) {
          reached.set(key, distance + 1)
          queue.push([i + di, j + dj, distance + 1])
        }
      }
    }
    for (const [key, hops] of reached) {
      const [i, j] = key.split(",").map(Number)
      expect(grid.distance(0, 0, i, j)).toBeCloseTo(hops * 0.2, 10)
    }
  })
})
describe("finite-width physical geometry", () => {})
