import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Solver } from "../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("spatial future-point search preserves live penalties and direct linear behavior", () => {
  const opts = {
    connectionName: "route",
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    A: { x: 1, y: 1, z: 0 },
    B: { x: 9, y: 9, z: 0 },
    traceThickness: 0.2,
    obstacleMargin: 0.1,
    layerCount: 4,
    obstacleRoutes: [],
    futureConnections: [{
      connectionName: "future",
      points: Array.from({ length: 24 }, (_, i) => ({ x: (i % 6) * 1.5, y: Math.floor(i / 6) * 1.5, z: i % 4 })),
    }],
  }
  const linear = new Solver(opts)
  const spatial = new Solver({ ...opts, futurePointSearch: "spatial" })
  for (const penaltyFactor of [0, 0.25, 4, -2, Infinity, NaN]) {
    linear.VIA_PENALTY_FACTOR = penaltyFactor
    spatial.VIA_PENALTY_FACTOR = penaltyFactor
    for (let i = 0; i < 24; i++) {
      const node = { x: i / 3, y: i % 5, z: i % 4, g: 0, h: 0, f: 0, parent: null }
      expect(spatial.getClosestFutureConnectionPoint(node)).toBe(linear.getClosestFutureConnectionPoint(node))
    }
  }
  // Direct callers have not opted into fixed geometry and retain live point edits.
  linear.VIA_PENALTY_FACTOR = 0
  linear.futureConnectionPoints[0].x = 8
  linear.futureConnectionPoints[0].y = 8
  expect(linear.getClosestFutureConnectionPoint({ x: 8, y: 8, z: 0 } as any)).toBe(linear.futureConnectionPoints[0])
})
