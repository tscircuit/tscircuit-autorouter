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
})
describe("finite-width physical geometry", () => {
  test("crossing segments and parallel clearance", () => {
    expect(
      segmentDistance(
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: -1 },
        { x: 0, y: 1 },
      ),
    ).toBe(0)
    expect(
      segmentDistance(
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: -1, y: 0.25 },
        { x: 1, y: 0.25 },
      ),
    ).toBeCloseTo(0.25, 10)
  })
})
