import type { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

export const sparseOptions: ConstructorParameters<
  typeof SparsePhysicalSingleRouteSolver
>[0] = {
  connectionName: "a",
  minDistBetweenEnteringPoints: 0.2,
  bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
  A: { x: 1, y: 5, z: 0 },
  B: { x: 9, y: 5, z: 0 },
  traceThickness: 0.2,
  obstacleMargin: 0.1,
  layerCount: 4,
  availableZ: [0, 1, 2, 3],
  viaDiameter: 0.4,
  viaHoleDiameter: 0.2,
  minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
  obstacleRoutes: [],
}

export const crossingWire: HighDensityIntraNodeRoute = {
  connectionName: "b",
  traceThickness: 0.8,
  viaDiameter: 0.4,
  route: [
    { x: 5, y: 3, z: 0 },
    { x: 5, y: 7, z: 0 },
  ],
  vias: [],
}

export const throughVia: HighDensityIntraNodeRoute = {
  connectionName: "b",
  traceThickness: 0.2,
  viaDiameter: 0.4,
  route: [
    { x: 5, y: 5, z: 0 },
    { x: 5, y: 5, z: 1 },
  ],
  vias: [{ x: 5, y: 5 }],
}
