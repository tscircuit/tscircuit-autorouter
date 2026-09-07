import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a planar edge rejects a via between legal endpoints without same-layer obstacle segments", (): void => {
  const obstacle: HighDensityIntraNodeRoute = {
    connectionName: "foreign",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0.3, z: 0 },
      { x: 0, y: 0.3, z: 1 },
    ],
    vias: [{ x: 0, y: 0.3 }],
  }
  const start: Node = {
    x: -0.4,
    y: 0,
    z: 0,
    g: 0,
    h: 0,
    f: 0,
    parent: null,
  }
  const end: Node = { ...start, x: 0.4, parent: start }

  for (const Solver of [
    SingleHighDensityRouteSolver,
    SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost,
  ]) {
    const solver = new Solver({
      connectionName: "signal",
      obstacleRoutes: [obstacle],
      minDistBetweenEnteringPoints: 4,
      bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
      A: { x: -4, y: 0, z: 0 },
      B: { x: 4, y: 0, z: 0 },
      traceThickness: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      captureSearchDebug: false,
    })
    expect(solver.obstacleSegments).toHaveLength(0)
    expect(solver.isNodeTooCloseToObstacle(start)).toBe(false)
    expect(solver.isNodeTooCloseToObstacle(end)).toBe(false)
    expect(solver.doesPathToParentIntersectObstacle(end)).toBe(true)
    expect(solver.doesPathToParentIntersectObstacle(start)).toBe(false)
  }
})
