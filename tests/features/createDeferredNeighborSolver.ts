import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

export function createDeferredNeighborSolver(
  deferClosedNeighborNodes: boolean,
): SingleHighDensityRouteSolver {
  return new SingleHighDensityRouteSolver({
    connectionName: "route",
    obstacleRoutes: [],
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    A: { x: -1, y: -1, z: 0 },
    B: { x: 1, y: 1, z: 1 },
    minDistBetweenEnteringPoints: 0.05,
    layerCount: 4,
    availableZ: [0, 1, 2, 3],
    futureConnections: [
      {
        connectionName: "future",
        points: [{ x: 0, y: 0, z: 0 }],
      },
    ],
    captureSearchDebug: true,
    deferClosedNeighborNodes,
  })
}
