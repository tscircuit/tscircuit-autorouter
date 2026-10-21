import { expect, spyOn, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createHighDensityRepairRuntimeFixture } from "../fixtures/createHighDensityRepairRuntimeFixture"

test("parallel repair preserves finite iteration prefixes and resumes with either solve mode", async (): Promise<void> => {
  for (const limit of [0, 1, 2, 3, 5, 8, Infinity]) {
    for (const resumeAsync of [false, true]) {
      const baseline = new Pipeline4HighDensityRepairSolver(createHighDensityRepairRuntimeFixture())
      const solver = new Pipeline4HighDensityRepairSolver(createHighDensityRepairRuntimeFixture())
      const runtime = new SolverRuntime()
      const dispatch = spyOn(runtime, "executeAsync")
      while (!baseline.solved && !baseline.failed && baseline.iterations < limit) baseline.step()
      await solver.solveAsync(runtime, limit)
      expect(solver.getOutput()).toEqual(baseline.getOutput())
      expect(solver.stats).toEqual(baseline.stats)
      expect(solver.iterations).toBe(baseline.iterations)
      expect(solver.solved).toBe(baseline.solved)
      expect(solver.activeSampleIndex).toBe(baseline.activeSampleIndex)
      expect(Boolean(solver.activeSubSolver)).toBe(Boolean(baseline.activeSubSolver))
      expect(dispatch).toHaveBeenCalledTimes(Math.min(4, Math.floor(limit / 2)))
      baseline.solve()
      if (resumeAsync) await solver.solveAsync(runtime)
      else solver.solve()
      expect(solver.getOutput()).toEqual(baseline.getOutput())
      expect(solver.stats).toEqual(baseline.stats)
      expect(solver.iterations).toBe(baseline.iterations)
      expect(solver.solved).toBe(baseline.solved)
      expect(solver.failed).toBe(baseline.failed)
      dispatch.mockRestore()
      await runtime.dispose()
    }
  }
})
