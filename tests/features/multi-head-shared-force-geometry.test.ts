import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"

test("shared force geometry preserves segment and via interactions", (): void => {
  const lines: PolyLine2[] = [
    {
      connectionName: "a",
      start: { x: -2, y: 0, z1: 0, z2: 0 },
      end: { x: 2, y: 0, z1: 0, z2: 0 },
      mPoints: [
        { x: -0.3, y: 0.1, z1: 0, z2: 1 },
        { x: 0.3, y: 0.1, z1: 1, z2: 0 },
      ],
    },
    {
      connectionName: "b",
      start: { x: 0, y: -2, z1: 0, z2: 0 },
      end: { x: 0, y: 2, z1: 0, z2: 0 },
      mPoints: [
        { x: 0.1, y: -0.2, z1: 0, z2: 1 },
        { x: 0.1, y: 0.2, z1: 1, z2: 0 },
      ],
    },
    {
      connectionName: "c",
      start: { x: -2, y: 1, z1: 0, z2: 0 },
      end: { x: 2, y: 1, z1: 0, z2: 0 },
      mPoints: [
        { x: -0.2, y: 0.15, z1: 0, z2: 0 },
        { x: 0.2, y: 0.15, z1: 0, z2: 0 },
      ],
    },
  ]
  const solver = new MultiHeadPolyLineIntraNodeSolver2({
    nodeWithPortPoints: {
      capacityMeshNodeId: "force-regression",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      portPoints: [],
    },
    viaDiameter: 0.3,
  })
  solver.applyForcesToPolyLines(lines)
  const result = solver.applyForcesToPolyLines(lines)
  // Captured from the original implementation before sharing pair geometry.
  expect(result).toEqual({
    lastStepMoved: true,
    magForceApplied: 0.16702740345331085,
  })
  expect(lines.map((line) => line.mPoints)).toEqual([
    [
      { x: -0.54124091901241, y: -0.08449349863351124, z1: 0, z2: 1 },
      { x: 0.624273715727779, y: -0.08114998300040845, z1: 1, z2: 0 },
    ],
    [
      { x: 0.0744009360034361, y: -0.38243849734363733, z1: 0, z2: 1 },
      { x: -0.02512759971978976, y: 0.5920732996618636, z1: 1, z2: 0 },
    ],
    [
      { x: -0.18462292728024113, y: 0.19498154042329316, z1: 0, z2: 0 },
      { x: 0.22713998524009063, y: 0.1781710766839922, z1: 0, z2: 0 },
    ],
  ])
})
