import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

function makeViaLines(separation: number): PolyLine2[] {
  return [0, separation].map((y, index) => ({
    connectionName: index === 0 ? "branch-a" : "branch-b",
    start: { x: -1, y, z1: 0, z2: 0 },
    mPoints: [{ x: 0, y, z1: 0, z2: 1 }],
    end: { x: 1, y, z1: 1, z2: 1 },
  }))
}

function createSolver(
  Solver: typeof MultiHeadPolyLineIntraNodeSolver,
  lines: PolyLine2[],
  connMap: ConnectivityMap,
): MultiHeadPolyLineIntraNodeSolver {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "drill-clearance",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: lines.flatMap((line) => [
      { connectionName: line.connectionName, x: line.start.x, y: line.start.y, z: line.start.z1 },
      { connectionName: line.connectionName, x: line.end.x, y: line.end.y, z: line.end.z2 },
    ]),
  }
  return new Solver({
    nodeWithPortPoints,
    connMap,
    viaDiameter: 0.6,
    viaHoleDiameter: 0.15,
    minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    hyperParameters: { MINIMUM_FINAL_ACCEPTANCE_GAP: 0.01 },
  })
}

test("polyline acceptance enforces drill spacing independently from connected copper clearance", (): void => {
  const connected = new ConnectivityMap({ ground: ["branch-a", "alias-a"] })
  connected.addConnections([["alias-a", "branch-b"]])
  const separate = new ConnectivityMap({ signalA: ["branch-a"], signalB: ["branch-b"] })

  for (const Solver of [MultiHeadPolyLineIntraNodeSolver, MultiHeadPolyLineIntraNodeSolver2]) {
    for (const [separation, expected] of [[0.1, false], [0.3, true], [0, true]] as const) {
      const lines = makeViaLines(separation)
      const solver = createSolver(Solver, lines, connected)
      const minGaps = solver.computeMinGapBtwPolyLines(lines)
      expect(minGaps).toHaveLength(0)
      expect(solver.checkIfSolved({ polyLines: lines, minGaps })).toBe(expected)
    }

    // Distinct nets cannot reuse a drill or overlap copper annuli.
    for (const separation of [0, 0.3]) {
      const lines = makeViaLines(separation)
      const solver = createSolver(Solver, lines, separate)
      expect(solver.checkIfSolved({
        polyLines: lines,
        minGaps: solver.computeMinGapBtwPolyLines(lines),
      })).toBe(false)
    }

    // Connected copper still shares an overlapping wire without a drill.
    const copper = makeViaLines(0)
    for (const line of copper) {
      line.mPoints[0]!.z2 = 0
      line.end.z1 = line.end.z2 = 0
    }
    const copperSolver = createSolver(Solver, copper, connected)
    expect(copperSolver.checkIfSolved({
      polyLines: copper,
      minGaps: copperSolver.computeMinGapBtwPolyLines(copper),
    })).toBe(true)

    // Two transitions on a single route also represent distinct drill sites.
    for (const [separation, expected] of [[0.1, false], [0.3, true], [0, true]] as const) {
      const lines: PolyLine2[] = [{
        connectionName: "branch-a",
        start: { x: -1, y: 0, z1: 0, z2: 0 },
        mPoints: [
          { x: 0, y: 0, z1: 0, z2: 1 },
          { x: separation, y: 0, z1: 1, z2: 0 },
        ],
        end: { x: 1, y: 0, z1: 0, z2: 0 },
      }]
      const solver = createSolver(Solver, lines, connected)
      expect(solver.checkIfSolved({ polyLines: lines, minGaps: [] })).toBe(expected)
    }

    // A third net makes the relaxed final-gap acceptance path eligible.
    for (const [separation, expected] of [[0.1, false], [0.3, true]] as const) {
      const lines = makeViaLines(separation)
      lines.push({
        connectionName: "other-net",
        start: { x: -1, y: 1.2, z1: 0, z2: 0 },
        mPoints: [{ x: 0, y: 1.2, z1: 0, z2: 0 }],
        end: { x: 1, y: 1.2, z1: 0, z2: 0 },
      })
      const solver = createSolver(Solver, lines, connected)
      const minGaps = solver.computeMinGapBtwPolyLines(lines)
      expect(minGaps.length).toBeGreaterThan(0)
      expect(Math.min(...minGaps)).toBeGreaterThan(0.01)
      solver.lastCandidate = { polyLines: lines, minGaps, g: 0, h: 0, f: 0, viaCount: 2 }
      solver.tryFinalAcceptance()
      expect(solver.solved).toBe(expected)
    }
  }
})
