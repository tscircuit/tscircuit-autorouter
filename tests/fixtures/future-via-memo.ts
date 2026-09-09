import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Solver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

export type ClearanceMemo = {
  x: number
  y: number
  threshold: number
  segments: ReturnType<Solver["getFutureConnectionSegments"]>
  tooClose: boolean
}

export const createFutureViaSolver = (
  fixedFutureConnectionGeometry = false,
  layerCount = 4,
): Solver => new Solver({
  connectionName: "route",
  A: { x: -2, y: -0.7, z: 0 },
  B: { x: 2, y: 0.7, z: layerCount - 1 },
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  minDistBetweenEnteringPoints: 0.15,
  obstacleRoutes: [],
  layerCount,
  availableZ: Array.from({ length: layerCount }, (_, z) => z),
  fixedFutureConnectionGeometry,
  futureConnections: [{
    connectionName: "future",
    points: [{ x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: layerCount - 1 }],
  }],
})

export const createFutureViaNode = (x = 0, y = 0, z = 0): Node => ({
  x,
  y,
  z,
  g: 0,
  h: 0,
  f: 0,
  parent: null,
})

// Frozen C37 predicate: keep its threshold, method dispatch, iteration and
// distance evaluation order independent of the implementation under test.
export const originalFutureViaClearance = (solver: Solver, node: Node): boolean => {
  const minCenterlineDistance = solver.viaDiameter / 2 +
    solver.traceThickness / 2 + solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE
  for (const segment of solver.getFutureConnectionSegments()) {
    if (pointToSegmentDistance(node, segment.start, segment.end) < minCenterlineDistance) {
      return true
    }
  }
  return false
}

export const readFutureViaMemo = (solver: Solver): ClearanceMemo | undefined =>
  (solver as unknown as { futureViaClearanceMemo?: ClearanceMemo }).futureViaClearanceMemo
