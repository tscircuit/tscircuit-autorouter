import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("future connection penalty uses the nearest via-adjusted point", (): void => {
  const solver = new SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost({
    connectionName: "current",
    minDistBetweenEnteringPoints: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    A: { x: 0, y: 0, z: 0 },
    B: { x: 10, y: 10, z: 0 },
    obstacleRoutes: [],
    traceThickness: 0.2,
    obstacleMargin: 0.1,
    layerCount: 2,
    futureConnections: [
      {
        connectionName: "future",
        points: [
          { x: 3, y: 0, z: 0 },
          { x: 0.25, y: 0, z: 1 },
        ],
      },
    ],
  })
  const node = { x: 0, y: 0, z: 0 }
  const closestFuturePoint = solver.getClosestFutureConnectionPoint(node)!
  const distToFuturePoint = Math.hypot(
    node.x - closestFuturePoint.x,
    node.y - closestFuturePoint.y,
  )
  const expectedPenalty =
    solver.straightLineDistance *
    solver.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR *
    Math.exp(
      (-distToFuturePoint * 5) /
        (solver.viaDiameter * solver.FUTURE_CONNECTION_PROXIMITY_VD),
    )

  expect(solver.getFutureConnectionPenalty(node, false)).toBeCloseTo(
    expectedPenalty,
    12,
  )
})
