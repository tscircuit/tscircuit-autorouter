import { expect, test } from "bun:test"
import { distance, pointToSegmentDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("rejects a layer-change shortcut whose central via intersects a pad", (): void => {
  const center = { x: 0, y: 0 }
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "signal",
    A: { x: -0.8, y: 0, z: 0 },
    B: { x: 0.8, y: 0, z: 1 },
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    minDistBetweenEnteringPoints: 1,
    obstacleRoutes: [],
    padObstacles: [
      {
        type: "rect",
        shape: "circle",
        center,
        width: 0.3,
        height: 0.3,
        layers: ["bottom"],
        __zLayers: [1],
        connectedTo: ["other"],
      },
    ],
    availableZ: [0, 1],
    traceThickness: 0.1,
    viaDiameter: 0.3,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  const result = solver.solvedPath!
  expect(result.vias).toHaveLength(1)
  for (const via of result.vias) {
    expect(distance(center, via)).toBeGreaterThanOrEqual(0.3 - 1e-6)
  }
  for (let index = 1; index < result.route.length; index++) {
    const start = result.route[index - 1]!
    const end = result.route[index]!
    if (start.z !== 1 || end.z !== 1) continue
    expect(pointToSegmentDistance(center, start, end)).toBeGreaterThanOrEqual(
      0.2 - 1e-6,
    )
  }
})

