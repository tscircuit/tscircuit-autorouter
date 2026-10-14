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
  test("routes a three-terminal physical tree and excludes trivial nets", () => {
    const input = {
      bounds,
      obstacles: [],
      connections: [
        {
          name: "n",
          pointsToConnect: [
            { x: -2, y: -1, layer: "top" },
            { x: 2, y: 1, layer: "top" },
            { x: -1, y: 2, layer: "top" },
          ],
        },
        { name: "trivial", pointsToConnect: [{ x: 1, y: 1, layer: "top" }] },
      ],
      layerCount: 2,
      minTraceWidth: 0.1,
    }
    const result = routeDataset(input, {
      grid: "hex",
      pitch: 0.2,
      timeLimit: 2,
    })
    expect(result.experiment.completedConnectionNames).toEqual(["n"])
    expect(result.experiment.noRouteRequiredConnectionNames).toEqual([
      "trivial",
    ])
    expect(result.traces.length).toBe(2)
    expect(result.traces.every((t) => t.route.length >= 2)).toBe(true)
  })
})
