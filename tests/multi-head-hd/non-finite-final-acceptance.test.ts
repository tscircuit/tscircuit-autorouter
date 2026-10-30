import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"

test("final acceptance rejects non-finite via coordinates", (): void => {
  for (const Solver of [
    MultiHeadPolyLineIntraNodeSolver,
    MultiHeadPolyLineIntraNodeSolver2,
  ]) {
    for (const coordinate of [0, Number.NaN, Infinity, -Infinity]) {
      const solver = new Solver({
        nodeWithPortPoints: {
          capacityMeshNodeId: "cell",
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          availableZ: [0, 1],
          portPoints: [],
        },
        hyperParameters: { MINIMUM_FINAL_ACCEPTANCE_GAP: 0.01 },
      })
      solver.phase = "solving"
      solver.lastCandidate = {
        polyLines: [
          {
            connectionName: "signal",
            start: { x: -0.4, y: 0, z1: 0, z2: 0 },
            end: { x: 0.4, y: 0, z1: 1, z2: 1 },
            mPoints: [{ x: 0, y: coordinate, z1: 0, z2: 1 }],
          },
        ],
        g: 0,
        h: 0,
        f: 0,
        minGaps: [0.05],
        viaCount: 1,
      }
      solver.step()
      expect(solver.solved).toBe(Number.isFinite(coordinate))
      expect(solver.failed).toBe(!Number.isFinite(coordinate))
    }
  }
})
