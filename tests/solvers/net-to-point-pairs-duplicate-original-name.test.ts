import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"

test("duplicate original connection names fail loudly", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "duplicate",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
      {
        name: "duplicate",
        pointsToConnect: [
          { x: 1, y: 0, layer: "top" },
          { x: 2, y: 0, layer: "top" },
        ],
      },
    ],
  }

  expect(() => new NetToPointPairsSolver(srj)).toThrow(
    'Original SimpleRouteJson contains duplicate connection name "duplicate"',
  )
})
