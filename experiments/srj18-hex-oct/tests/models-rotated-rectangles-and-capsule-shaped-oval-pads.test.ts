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
  test("models rotated rectangles and capsule-shaped oval pads", () => {
    const diagonalRect = {
      ...rect(0, 0),
      width: 1,
      ccwRotationDegrees: 45,
    }
    const onRotatedPad = { x: 0.3, y: 0.3 }
    expect(
      segmentObstacleDistance(onRotatedPad, onRotatedPad, diagonalRect),
    ).toBe(0)
    const capsule = { ...rect(0, 0), type: "oval", width: 2, height: 1 }
    const insideCapsuleOutsideEllipse = { x: 0.75, y: 0.4 }
    expect(
      segmentObstacleDistance(
        insideCapsuleOutsideEllipse,
        insideCapsuleOutsideEllipse,
        capsule,
      ),
    ).toBe(0)
  })

  for (const grid of ["hex", "oct"] as const) {
  }
})
