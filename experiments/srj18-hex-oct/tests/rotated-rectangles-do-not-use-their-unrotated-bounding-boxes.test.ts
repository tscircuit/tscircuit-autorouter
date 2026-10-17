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
  test("rotated rectangles do not use their unrotated bounding boxes", () => {
    const rect = {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 2,
      height: 0.2,
      layers: ["top"],
      ccwRotationDegrees: 45,
    }
    expect(
      segmentObstacleDistance({ x: 0.6, y: 0.6 }, { x: 0.6, y: 0.6 }, rect),
    ).toBe(0)
    expect(
      segmentObstacleDistance({ x: 0.6, y: -0.6 }, { x: 0.6, y: -0.6 }, rect),
    ).toBeGreaterThan(0.7)
  })
})
