import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

test("a target inside fixed trace clearance fails before exploring candidates", () => {
  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    const solver = new Solver({
      connectionName: "target",
      A: { x: 1, y: 1, z: 0 },
      B: { x: 8, y: 8, z: 0 },
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      minDistBetweenEnteringPoints: 0.1,
      captureSearchDebug: false,
      obstacleRoutes: [
        {
          connectionName: "obstacle",
          traceThickness: 0.15,
          viaDiameter: 0.3,
          route: [
            { x: 7, y: 8, z: 0 },
            { x: 9, y: 8, z: 0 },
          ],
          vias: [],
        },
      ],
    })
    solver.solve()
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.iterations).toBe(1)
    expect(solver.exploredNodes.size).toBe(0)
    expect(solver.error).toContain("inside fixed obstacle segment clearance")
  }
})
