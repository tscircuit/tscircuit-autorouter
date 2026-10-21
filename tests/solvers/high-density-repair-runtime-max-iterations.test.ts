import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createHighDensityRepairRuntimeFixture } from "../fixtures/createHighDensityRepairRuntimeFixture"

test("parallel repair reports the same iteration exhaustion as serial repair", async (): Promise<void> => {
  const runtime = new SolverRuntime()
  try {
    for (const limit of [0, 1, 2, 3, 7, 8]) {
      const baseline = new Pipeline4HighDensityRepairSolver(
        createHighDensityRepairRuntimeFixture(),
      )
      const solver = new Pipeline4HighDensityRepairSolver(
        createHighDensityRepairRuntimeFixture(),
      )
      baseline.MAX_ITERATIONS = limit
      solver.MAX_ITERATIONS = limit
      baseline.solve()
      await solver.solveAsync(runtime)
      expect(solver.getOutput()).toEqual(baseline.getOutput())
      expect(solver.stats).toEqual(baseline.stats)
      expect(solver.iterations).toBe(baseline.iterations)
      expect(solver.solved).toBe(baseline.solved)
      expect(solver.failed).toBe(baseline.failed)
      expect(solver.error).toBe(baseline.error)
    }
  } finally {
    await runtime.dispose()
  }
})
