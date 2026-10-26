import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"

export type FuturePoint = { x: number; y: number; z: number }

export function futureGeometrySolver(
  points: FuturePoint[],
): Native {
  return new Native({
    connectionName: "current",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    A: { x: -10, y: 0, z: 0 },
    B: { x: 10, y: 0, z: 1 },
    layerCount: 2,
    futureConnections: [{ connectionName: "future", points }],
    captureSearchDebug: false,
  })
}

export function referenceFutureTraceQuery(
  solver: Native,
  node: Node,
): boolean {
  const radius =
    solver.viaDiameter / 2 +
    solver.traceThickness / 2 +
    solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE
  for (const segment of solver.getFutureConnectionSegments()) {
    if (pointToSegmentDistance(node, segment.start, segment.end) < radius) {
      return true
    }
  }
  return false
}
