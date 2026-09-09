import { expect, test } from "bun:test"
import {
  type Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("goal completion checks the whole final connector against via copper", (): void => {
  for (const viaY of [0.3, 0.5]) {
    const obstacle: HighDensityIntraNodeRoute = {
      connectionName: "foreign",
      traceThickness: 0.15,
      viaDiameter: 0.3,
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
      B: { x: 0.4, y: 0, z: 0 },
      traceThickness: 0.15,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      availableZ: [0],
      captureSearchDebug: false,
    })
    const start: Node = { ...solver.A, g: 0, h: 0, f: 0, parent: null }
    const nearGoal: Node = { ...start, x: -0.4, parent: start }
    const goal: Node = { ...nearGoal, x: solver.B.x, parent: nearGoal }
    expect(solver.cellStep).toBe(0.8)
    expect(solver.isNodeTooCloseToObstacle(nearGoal)).toBe(false)
    expect(solver.isNodeTooCloseToObstacle(goal)).toBe(false)
    solver.candidates = new SingleRouteCandidatePriorityQueue([nearGoal])

    solver.step()

    expect(solver.failed).toBe(false)
    expect(solver.solved).toBe(viaY === 0.5)
    if (viaY === 0.3) expect(solver.solvedPath).toBeNull()
    else expect(solver.solvedPath?.route.at(-1)).toMatchObject(solver.B)
  }
})
