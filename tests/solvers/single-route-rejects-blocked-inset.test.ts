import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("uses the search when an inset shortcut still intersects an obstacle", (): void => {
  const obstacles = [
    { center: { x: 0.3, y: -0.1 }, diameter: 0.3 },
    { center: { x: 0.5, y: 0.085 }, diameter: 0.04 },
  ]
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "signal",
    A: { x: 1, y: 0, z: 0 },
    B: { x: 0, y: 0.1, z: 0 },
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 2 },
    minDistBetweenEnteringPoints: 1,
    obstacleRoutes: [],
    padObstacles: obstacles.map(({ center, diameter }) => ({
      type: "rect" as const,
      shape: "circle" as const,
      center,
      width: diameter,
      height: diameter,
      layers: ["top"],
      __zLayers: [0],
      connectedTo: ["other"],
    })),
    availableZ: [0],
    traceThickness: 0.1,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const route = solver.solvedPath!.route
  for (const obstacle of obstacles) {
    for (let index = 1; index < route.length; index++) {
      expect(
        pointToSegmentDistance(
          obstacle.center,
          route[index - 1]!,
          route[index]!,
        ),
      ).toBeGreaterThanOrEqual(obstacle.diameter / 2 + 0.05 - 1e-6)
    }
  }
})
