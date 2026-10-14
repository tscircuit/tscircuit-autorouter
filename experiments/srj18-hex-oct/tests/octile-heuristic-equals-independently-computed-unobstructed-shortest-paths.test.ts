import { describe, expect, test } from "bun:test"
import { createOctGrid, octPitchAtHexDensity } from "../src/octGrid"

const bounds = { minX: -3.7, minY: 2.3, maxX: 9.1, maxY: 7.2 }

describe("octagonal lattice geometry", () => {

  test("octile heuristic equals independently computed unobstructed shortest paths", () => {
    const grid = createOctGrid(bounds, 0.31)
    // Dijkstra uses physical edge lengths and does not use the heuristic.
    const best = new Map<string, number>([["0,0", 0]])
    const pending: { i: number; j: number; cost: number }[] = [
      { i: 0, j: 0, cost: 0 },
    ]
    while (pending.length > 0) {
      pending.sort((a, b) => b.cost - a.cost)
      const current = pending.pop()!
      if (current.cost !== best.get(`${current.i},${current.j}`)) continue
      const p = grid.point(current.i, current.j)
      for (const [di, dj] of grid.directions) {
        const i = current.i + di
        const j = current.j + dj
        if (Math.abs(i) > 8 || Math.abs(j) > 8) continue
        const q = grid.point(i, j)
        const cost = current.cost + Math.hypot(q.x - p.x, q.y - p.y)
        const key = `${i},${j}`
        if (cost < (best.get(key) ?? Infinity) - 1e-12) {
          best.set(key, cost)
          pending.push({ i, j, cost })
        }
      }
    }
    for (let i = -7; i <= 7; i++) {
      for (let j = -7; j <= 7; j++) {
        expect(grid.distance(0, 0, i, j)).toBeCloseTo(best.get(`${i},${j}`)!, 10)
      }
    }
  })
})
