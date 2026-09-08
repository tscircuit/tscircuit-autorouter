import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver } from "../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver"
import type { Candidate } from "../../lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types1"

test("final polyline acceptance retains the normal physical via bounds", () => {
  const solver = new MultiHeadPolyLineIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "node",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      portPoints: [
        { x: -1, y: 0, z: 0, connectionName: "signal" },
        { x: 1, y: 0, z: 1, connectionName: "signal" },
      ],
    },
    viaDiameter: 0.3,
    hyperParameters: { MINIMUM_FINAL_ACCEPTANCE_GAP: 0.1 },
  })
  const candidate: Candidate = {
    polyLines: [
      {
        connectionName: "signal",
        start: { x: -1, y: 0, z1: 0, z2: 0 },
        end: { x: 1, y: 0, z1: 1, z2: 1 },
        mPoints: [{ x: 0.9, y: 0, z1: 0, z2: 1 }],
      },
    ],
    minGaps: [0.1],
    g: 0,
    h: 0,
    f: 0,
    viaCount: 1,
  }
  solver.lastCandidate = candidate
  solver.tryFinalAcceptance()
  expect(solver.solved).toBe(false)
  expect(solver.solvedRoutes).toEqual([])
  candidate.polyLines[0].mPoints[0].x = 0.75
  solver.tryFinalAcceptance()
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes[0].vias).toEqual([{ x: 0.75, y: 0 }])
})
