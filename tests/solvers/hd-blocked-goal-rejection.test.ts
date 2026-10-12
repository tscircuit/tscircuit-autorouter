import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as RouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("rejects an unreachable goal before exploring either layer", () => {
  const solver = new RouteSolver({
    connectionName: "signal",
    A: { x: -1, y: 0, z: 0 },
    B: { x: 1, y: 0, z: 0 },
    bounds: { minX: -1.5, maxX: 1.5, minY: -0.5, maxY: 0.5 },
    minDistBetweenEnteringPoints: 0.1,
    availableZ: [0, 1],
    obstacleRoutes: [
      {
        connectionName: "foreign",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 1.1, y: -0.4, z: 0 },
          { x: 1.1, y: 0.4, z: 0 },
        ],
        vias: [],
      },
    ],
    rejectBlockedGoal: true,
  })
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.iterations).toBe(1)
  expect(solver.error).toBe("Goal lies inside existing route clearance")
  expect(solver.debug_exploredNodesOrdered).toHaveLength(0)
})
