import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createHighDensityRepairRuntimeFixture } from "../fixtures/createHighDensityRepairRuntimeFixture"
import { createPipeline9TestRuntime } from "../fixtures/createPipeline9TestRuntime"

test("node repair preserves exact serial geometry and stats in one and four workers", async (): Promise<void> => {
  const baseline = new Pipeline4HighDensityRepairSolver(createHighDensityRepairRuntimeFixture())
  baseline.solve()
  for (const workerCount of [1, 4]) {
    const runtime = createPipeline9TestRuntime(workerCount)
    try {
      const solver = new Pipeline4HighDensityRepairSolver(createHighDensityRepairRuntimeFixture())
      await solver.solveAsync(runtime)
      expect(solver.getOutput()).toEqual(baseline.getOutput())
      expect(solver.stats).toEqual(baseline.stats)
      expect(solver.iterations).toBe(baseline.iterations)
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
    } finally {
      await runtime.dispose()
    }
  }
})
