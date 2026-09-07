import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("endpoint queries include larger obstacle copper and do not inflate smaller vias", (): void => {
  const cases = [
    { obstacleViaDiameter: 1, viaDiameter: 0.125, x: 0.5, blocked: true },
    { obstacleViaDiameter: 0.125, viaDiameter: 1, x: 0.25, blocked: false },
    { obstacleViaDiameter: 0.25, viaDiameter: 1, x: 0.25, blocked: false },
    { obstacleViaDiameter: 0.25, viaDiameter: 1, x: 0.21875, blocked: true },
  ]
  for (const fixture of cases) {
    const obstacle: HighDensityIntraNodeRoute = {
      connectionName: "foreign",
      traceThickness: 0.125,
      viaDiameter: fixture.obstacleViaDiameter,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    }
    const solver = new SingleHighDensityRouteSolver({
      connectionName: "signal",
      obstacleRoutes: [obstacle],
      minDistBetweenEnteringPoints: 4,
      bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
      A: { x: -4, y: -2, z: 0 },
      B: { x: 4, y: -2, z: 0 },
      traceThickness: 0.125,
      viaDiameter: fixture.viaDiameter,
      obstacleMargin: 0.0625,
      captureSearchDebug: false,
    })
    const point: Node = {
      x: fixture.x,
      y: 0,
      z: 0,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }
    expect(solver.isNodeTooCloseToObstacle(point)).toBe(fixture.blocked)
  }
})
