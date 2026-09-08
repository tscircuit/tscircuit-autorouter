import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver2_Optimized"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { applyForcesReference } from "tests/fixtures/polyline-force-reference"
import cn27515 from "fixtures/legacy/assets/cn27515-nodeWithPortPoints.json"
import cn705 from "fixtures/legacy/assets/cn705-nodeWithPortPoints.json"

test("polyline geometry reuse preserves complete candidate state during fixture searches", () => {
  const fixtures = [
    {
      capacityMeshNodeId: "force-simple", center: { x: 5, y: 5 }, width: 2, height: 2,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "A", x: 4, y: 4, z: 1 },
        { connectionName: "A", x: 6, y: 6, z: 0 },
        { connectionName: "B", x: 5, y: 4, z: 0 },
        { connectionName: "B", x: 4, y: 6, z: 1 },
      ],
    },
    cn27515.nodeWithPortPoints,
    cn705.nodeWithPortPoints,
  ]
  const state = (solver: MultiHeadPolyLineIntraNodeSolver2) => ({
    solved: solver.solved, failed: solver.failed, error: solver.error,
    iterations: solver.iterations, phase: solver.phase, progress: solver.progress,
    candidates: solver.candidates, lastCandidate: solver.lastCandidate,
    solvedRoutes: solver.solvedRoutes, unsolvedConnections: solver.unsolvedConnections,
  })
  let forceSteps = 0
  for (const Solver of [MultiHeadPolyLineIntraNodeSolver2, MultiHeadPolyLineIntraNodeSolver3]) {
    for (const nodeWithPortPoints of fixtures) {
      const options = { nodeWithPortPoints, hyperParameters: { SEGMENTS_PER_POLYLINE: 4 } }
      const optimized = new Solver(options)
      const reference = new Solver(options)
      reference.applyForcesToPolyLines = applyForcesReference
      // Exercise setup, repeated force steps, candidate ranking and terminal
      // handling with a deterministic bound for difficult fixture searches.
      optimized.MAX_ITERATIONS = reference.MAX_ITERATIONS = 100
      while (!optimized.solved && !optimized.failed) {
        optimized.step()
        reference.step()
        if (optimized.lastCandidate?.magForceApplied !== undefined) forceSteps++
        expect(state(optimized)).toEqual(state(reference))
      }
      expect(state(optimized)).toEqual(state(reference))
    }
  }
  expect(forceSteps).toBeGreaterThan(100)
})
