import { MultiHeadPolylineContactSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolylineContactSolver"
import type { Candidate, PolyLine } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { PolylineContactPhysicalContext } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/validatePolylineContactRoutes"

export const createPolylineContactFixture = (workCap = 100_000): {
  solver: MultiHeadPolylineContactSolver
  candidate: Candidate
  node: NodeWithPortPoints
  context: PolylineContactPhysicalContext
} => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "contact-fixture", center: { x: 0, y: 0 }, width: 6, height: 4,
    availableZ: [0, 1],
    portPoints: [-1, 1].flatMap((side) => [-1, 1].map((vertical) => ({
      connectionName: vertical < 0 ? "a" : "b", x: side * 2.5, y: vertical * 0.5, z: 0,
    }))),
  }
  const context: PolylineContactPhysicalContext = {
    nodeWithPortPoints: node, traceWidth: 0.15, viaDiameter: 0.3,
    obstacleMargin: 0.1, obstacles: [], layerCount: 2,
  }
  const solver = new MultiHeadPolylineContactSolver({
    ...context,
    contactWorkCap: workCap, hyperParameters: { SEGMENTS_PER_POLYLINE: 3 },
  })
  const lines: PolyLine[] = [-1, 1].map((sign): PolyLine => ({
    connectionName: sign < 0 ? "a" : "b",
    start: { x: -2.5, y: sign * 0.5, z1: 0, z2: 0 },
    end: { x: 2.5, y: sign * 0.5, z1: 0, z2: 0 },
    mPoints: [-0.4, 0.4].map((x) => ({ x, y: sign * 0.02, z1: 0, z2: 0 })),
  }))
  const candidate: Candidate = {
    polyLines: lines, g: 0, h: 0, f: 0, viaCount: 0,
    minGaps: solver.computeMinGapBtwPolyLines(lines),
  }
  solver.phase = "solving"
  solver.candidates = [candidate]
  return { solver, candidate, node, context }
}
