import { expect, test } from "bun:test"
import {
  SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as RouteSolver,
} from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("preserves the route when the goal clears a same-layer obstacle", () => {
  const routes: Array<RouteSolver["solvedPath"]> = []
  for (const rejectBlockedGoal of [false, true]) {
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
            { x: 1.3, y: -0.4, z: 0 },
            { x: 1.3, y: 0.4, z: 0 },
          ],
          vias: [],
        },
      ],
      rejectBlockedGoal,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    routes.push(solver.solvedPath)
  }
  expect(routes[1]).toEqual(routes[0])
})
