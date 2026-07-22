import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"

test("a transformed constituent missing from the original SRJ fails loudly", () => {
  const originalSrj: SimpleRouteJson = {
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 1 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [],
    connections: [
      {
        name: "original_connection",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
  }
  const transformedSrj: SimpleRouteJson = {
    ...originalSrj,
    connections: [
      {
        name: "unexpected_transformed_connection",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 1, y: 0, layer: "top" },
        ],
      },
    ],
  }

  expect(
    () => new NetToPointPairsSolver(transformedSrj, {}, originalSrj),
  ).toThrow(
    'Could not match pre-merge connection "unexpected_transformed_connection" to an original SimpleRouteJson connection',
  )
})
