import { expect, test } from "bun:test"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("edge clearance uses actual mixed copper sizes and admits exact equality", (): void => {
  const dimensions = [
    { traceThickness: 0.125, obstacleViaDiameter: 1, viaDiameter: 0.125 },
    { traceThickness: 0.5, obstacleViaDiameter: 0.125, viaDiameter: 1 },
    { traceThickness: 0.25, obstacleViaDiameter: 0.5, viaDiameter: 0.25 },
  ]
  const obstacleMargin = 0.125
  for (const dimension of dimensions) {
    const requiredDistance =
      dimension.traceThickness / 2 +
      dimension.obstacleViaDiameter / 2 +
      obstacleMargin
    for (const offset of [-0.03125, 0, 0.03125]) {
      const viaY = requiredDistance + offset
      const obstacle: HighDensityIntraNodeRoute = {
        connectionName: "foreign",
        traceThickness: 0.125,
        viaDiameter: dimension.obstacleViaDiameter,
        route: [
          { x: 0, y: viaY, z: 0 },
          { x: 0, y: viaY, z: 1 },
        ],
        vias: [{ x: 0, y: viaY }],
      }
      const solver = new SingleHighDensityRouteSolver({
        connectionName: "signal",
        obstacleRoutes: [obstacle],
        minDistBetweenEnteringPoints: 4,
        bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
        A: { x: -4, y: 0, z: 0 },
        B: { x: 4, y: 0, z: 0 },
        traceThickness: dimension.traceThickness,
        viaDiameter: dimension.viaDiameter,
        obstacleMargin,
        captureSearchDebug: false,
      })
      const start: Node = {
        x: -2,
        y: 0,
        z: 0,
        g: 0,
        h: 0,
        f: 0,
        parent: null,
      }
      const end: Node = { ...start, x: 2, parent: start }
      const reverseEnd: Node = {
        ...start,
        parent: { ...end, parent: null },
      }

      expect(solver.isNodeTooCloseToObstacle(start)).toBe(false)
      expect(solver.isNodeTooCloseToObstacle(end)).toBe(false)
      expect(solver.doesPathToParentIntersectObstacle(end)).toBe(offset < 0)
      expect(solver.doesPathToParentIntersectObstacle(reverseEnd)).toBe(
        offset < 0,
      )
    }
  }
})
