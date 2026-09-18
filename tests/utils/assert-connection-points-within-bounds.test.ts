import { expect, test } from "bun:test"
import type { SimpleRouteJson } from "lib/types"
import { assertConnectionPointsWithinBounds } from "lib/utils/assertConnectionPointsWithinBounds"

test("validates on-board connection points against inclusive routing bounds", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -2, maxX: 3, minY: -4, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: -2, y: -4, layers: ["top", "bottom"] },
          { x: 3, y: 5, layer: "bottom" },
          { x: -2, y: 5, layer: "top" },
          { x: 3, y: -4, layer: "top" },
        ],
      },
      {
        name: "external",
        isOffBoard: true,
        pointsToConnect: [{ x: 20, y: 20, layer: "top" }],
      },
    ],
  }
  const originalSrj = structuredClone(srj)
  expect(() => assertConnectionPointsWithinBounds(srj)).not.toThrow()
  expect(srj).toEqual(originalSrj)

  for (const point of [
    { x: -2.001, y: 0 },
    { x: 3.001, y: 0 },
    { x: 0, y: -4.001 },
    { x: 0, y: 5.001 },
  ]) {
    srj.connections[0].pointsToConnect[1] = {
      ...point,
      layers: ["top", "bottom"],
    }
    expect(() => assertConnectionPointsWithinBounds(srj)).toThrow(
      `Connection "signal" point "1" at (${point.x}, ${point.y}) is outside routing bounds: x [-2, 3], y [-4, 5]`,
    )
  }
})
