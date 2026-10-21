import { expect, spyOn, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { Pipeline4HighDensityRepairSolver } from "../../lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createHighDensityRepairRuntimeFixture } from "../fixtures/createHighDensityRepairRuntimeFixture"

test("repair runtime errors reject and leave failed state instead of using serial repair", async (): Promise<void> => {
  const runtime = new SolverRuntime()
  const dispatch = spyOn(runtime, "executeAsync").mockRejectedValue(new Error("repair worker failed"))
  const solver = new Pipeline4HighDensityRepairSolver(createHighDensityRepairRuntimeFixture())
  const serial = spyOn(solver, "solve")
  try {
    await expect(solver.solveAsync(runtime)).rejects.toThrow("repair worker failed")
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).toContain("repair worker failed")
    expect(solver.activeSampleIndex).toBe(0)
    expect(serial).not.toHaveBeenCalled()
  } finally {
    dispatch.mockRestore()
    serial.mockRestore()
    await runtime.dispose()
  }
})
