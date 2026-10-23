import { expect, spyOn, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { createJointRepairRuntimeFixture } from "../fixtures/createJointRepairRuntimeFixture"

test("a joint repair worker transport failure remains an explicit solver failure", async (): Promise<void> => {
  const solver = createJointRepairRuntimeFixture(true)
  const runtime = new SolverRuntime()
  const dispatch = spyOn(runtime, "executeAsync").mockRejectedValue(
    new Error("worker disconnected"),
  )
  try {
    await expect(solver.solveAsync(runtime)).rejects.toThrow(
      "worker disconnected",
    )
    expect(solver.failed).toBeTrue()
    expect(solver.solved).toBeFalse()
    expect(solver.error).toContain("worker disconnected")
  } finally {
    dispatch.mockRestore()
    await runtime.dispose()
  }
})
