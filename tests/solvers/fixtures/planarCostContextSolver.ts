import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Solver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

export const parent: Node = { x: 0, y: 0, z: 0, f: 0, g: 0, h: 0, parent: null }
export const createSolver = (fixedObstacleGeometry: boolean): Solver => new Solver({
  connectionName: "route", A: { x: -2, y: 0, z: 0 }, B: { x: 2, y: 0, z: 1 },
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  minDistBetweenEnteringPoints: 0.15, fixedObstacleGeometry,
  traceThickness: 0.05, obstacleMargin: 0.05,
  obstacleRoutes: [], availableZ: [0, 1],
  futureConnections: [{ connectionName: "future", points: [{ x: 0, y: 1, z: 1 }] }],
})
