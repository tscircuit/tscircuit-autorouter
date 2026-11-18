import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("checks a diagonal shortcut whose midpoint is far from the node edges", (): void => {
  const center = { x: 0, y: 0 }
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "signal",
    A: { x: -1, y: -1, z: 0 },
    B: { x: 1, y: 1, z: 0 },
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    minDistBetweenEnteringPoints: 1,
    obstacleRoutes: [],
    padObstacles: [
      {
        type: "rect",
        shape: "circle",
        center,
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        __zLayers: [0],
        connectedTo: ["other"],
      },
    ],
    availableZ: [0],
    traceThickness: 0.1,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const route = solver.solvedPath!.route
  for (let index = 1; index < route.length; index++) {
    expect(
      pointToSegmentDistance(center, route[index - 1]!, route[index]!),
    ).toBeGreaterThanOrEqual(0.25 - 1e-6)
  }
})
