import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"

test("a trace without collision forces still projects its movable points inside the node boundary", (): void => {
  const input: PolyLine2[] = [
    {
      connectionName: "boundary-route",
      start: { x: -1, y: -1, z1: 0, z2: 0 },
      mPoints: [{ x: 0, y: -1, z1: 0, z2: 0 }],
      end: { x: 1, y: -1, z1: 0, z2: 0 },
    },
  ]
  for (const Solver of [
    MultiHeadPolyLineIntraNodeSolver,
    MultiHeadPolyLineIntraNodeSolver2,
  ]) {
    const solver = new Solver({
      nodeWithPortPoints: {
        capacityMeshNodeId: "zero-force-boundary",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        availableZ: [0, 1],
        portPoints: [],
      },
    })
    let lines = structuredClone(input)
    expect(solver.checkIfSolved({ polyLines: lines, minGaps: [] })).toBe(false)
    if (solver instanceof MultiHeadPolyLineIntraNodeSolver2) {
      expect(solver.applyForcesToPolyLines(lines).lastStepMoved).toBe(true)
    } else {
      const neighbors = solver.getNeighbors({
        polyLines: lines,
        minGaps: [],
        viaCount: 0,
        g: 0,
        h: 0,
        f: 0,
      })
      expect(neighbors).toHaveLength(1)
      lines = neighbors[0]!.polyLines
    }
    expect(lines[0]!.start).toEqual(input[0]!.start)
    expect(lines[0]!.end).toEqual(input[0]!.end)
    expect(lines[0]!.mPoints[0]!.x).toBe(0)
    expect(lines[0]!.mPoints[0]!.y).toBe(-0.875)
    expect(solver.checkIfSolved({ polyLines: lines, minGaps: [] })).toBe(true)
  }
})
