import { describe, expect, test } from "bun:test"
import { createHexGrid } from "../src/hexGrid"
import { routeDataset, segmentObstacleDistance, segmentDistance } from "../src/gridRouter"

const bounds = { minX: -5, minY: -5, maxX: 5, maxY: 5 }
describe("hexagonal geometry", () => {
  const grid = createHexGrid(bounds, 0.2)
})
describe("finite-width physical geometry", () => {
  test("oval pads are capsules, including the end caps", () => {
    const oval = { type: "oval", center: { x: 0, y: 0 }, width: 2, height: 1, layers: ["top"] }
    expect(segmentObstacleDistance({ x: 1.1, y: 0 }, { x: 1.1, y: 0 }, oval)).toBeCloseTo(0.1, 10)
    expect(segmentObstacleDistance({ x: 0.4, y: 0.5 }, { x: 0.4, y: 0.5 }, oval)).toBe(0)
  })
})
