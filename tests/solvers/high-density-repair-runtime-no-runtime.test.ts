import { expect, spyOn, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createHighDensityRepairRuntimeFixture } from "../fixtures/createHighDensityRepairRuntimeFixture"

test("repair without a runtime retains serial execution and active sample state", async (): Promise<void> => {
  const dispatch = spyOn(SolverRuntime.prototype, "executeAsync").mockImplementation(() => {
    throw new Error("Serial repair must not dispatch runtime samples")
  })
  try {
    for (const limit of [1, 3, Infinity]) {
      const baseline = new Pipeline4HighDensityRepairSolver(createHighDensityRepairRuntimeFixture())
      const solver = new Pipeline4HighDensityRepairSolver(createHighDensityRepairRuntimeFixture())
      baseline.step()
      solver.step()
      while (!baseline.solved && !baseline.failed && baseline.iterations < limit) baseline.step()
      await solver.solveAsync(undefined, limit)
      expect(solver.getOutput()).toEqual(baseline.getOutput())
      expect(solver.stats).toEqual(baseline.stats)
      expect(solver.iterations).toBe(baseline.iterations)
      expect(solver.solved).toBe(baseline.solved)
      expect(solver.activeSubSolver?.iterations).toBe(baseline.activeSubSolver?.iterations)
    }
    expect(dispatch).not.toHaveBeenCalled()
  } finally {
    dispatch.mockRestore()
  }
})
