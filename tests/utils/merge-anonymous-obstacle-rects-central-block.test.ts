import { expect, test } from "bun:test"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { addApproximatingRectsToSrj } from "lib/utils/addApproximatingRectsToSrj"

test("polygon strips with different widths share one rectangular interior", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 15, minY: -5, maxY: 15 },
    connections: [],
    obstacles: Array.from({ length: 6 }, (_, row): Obstacle => ({
      type: "rect",
      center: { x: row === 2 ? 4 : 5, y: row + 0.5 },
      width: row === 2 ? 12 : row === 4 ? 14 : 10,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: [],
    })),
  }
  const result = addApproximatingRectsToSrj(input)
  expect(result.obstacles).toHaveLength(4)
  expect(result.obstacles).toContainEqual({
    type: "rect",
    center: { x: 5, y: 3 },
    width: 10,
    height: 6,
    layers: ["top", "bottom"],
    connectedTo: [],
  })
  expect(result.connections).toEqual(input.connections)
  expect(input.obstacles).toHaveLength(6)
})
