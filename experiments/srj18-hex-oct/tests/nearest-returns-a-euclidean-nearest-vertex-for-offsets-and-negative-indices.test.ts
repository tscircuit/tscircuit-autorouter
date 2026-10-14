import { describe, expect, test } from "bun:test"
import { createOctGrid, octPitchAtHexDensity } from "../src/octGrid"

const bounds = { minX: -3.7, minY: 2.3, maxX: 9.1, maxY: 7.2 }

describe("octagonal lattice geometry", () => {
  test("nearest returns a Euclidean nearest vertex for offsets and negative indices", () => {
    const grid = createOctGrid(bounds, 0.31)
    // Sample irregular coordinates, including points beyond the board origin.
    for (let n = 0; n < 101; n++) {
      const x = bounds.minX + Math.sin(n * 17) * 2
      const y = bounds.minY + Math.cos(n * 13) * 2
      const [i, j] = grid.nearest(x, y)
      const chosen = grid.point(i, j)
      const chosenDistance = Math.hypot(chosen.x - x, chosen.y - y)
      for (let di = -2; di <= 2; di++) {
        for (let dj = -2; dj <= 2; dj++) {
          const other = grid.point(i + di, j + dj)
          expect(chosenDistance).toBeLessThanOrEqual(
            Math.hypot(other.x - x, other.y - y) + 1e-12,
          )
        }
      }
    }
  })
})
