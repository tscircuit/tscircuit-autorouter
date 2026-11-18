import { expect, test } from "bun:test"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("routes an interior horizontal shortcut around an unconnected obstacle", (): void => {
  const obstacle = {
    type: "rect" as const,
    center: { x: 0, y: 0 },
    width: 0.3,
    height: 0.3,
    layers: ["top"],
    __zLayers: [0],
    connectedTo: [],
  }
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "signal",
    A: { x: -0.8, y: 0, z: 0 },
    B: { x: 0.8, y: 0, z: 0 },
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    minDistBetweenEnteringPoints: 1,
    obstacleRoutes: [],
    obstacles: [obstacle],
    availableZ: [0],
    traceThickness: 0.1,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const route = solver.solvedPath!.route
  expect(route.length).toBeGreaterThan(2)
  for (let index = 1; index < route.length; index++) {
    expect(
      segmentToBoxMinDistance(route[index - 1]!, route[index]!, obstacle),
    ).toBeGreaterThanOrEqual(0.05 - 1e-6)
  }
})

