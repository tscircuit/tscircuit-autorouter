import { expect, spyOn, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { createJointRepairRuntimeFixture } from "../fixtures/createJointRepairRuntimeFixture"

test("a complete bounded repair wins and cancels the unused speculative branch", async (): Promise<void> => {
  const serial = createJointRepairRuntimeFixture()
  const parallel = createJointRepairRuntimeFixture()
  const runtime = new SolverRuntime()
  const dispatch = spyOn(runtime, "executeAsync")
  try {
    serial.solve()
    await parallel.solveAsync(runtime)
    expect(dispatch).toHaveBeenCalledTimes(1)
    const input = dispatch.mock.calls[0]![1] as { cancellation: Int32Array }
    expect(Atomics.load(input.cancellation, 0)).toBe(1)
    expect(parallel.stats.initialBoundedRegionalRepairAccepted).toBeTrue()
    expect(parallel.getOutput()).toEqual(serial.getOutput())
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.MAX_ITERATIONS).toBe(serial.MAX_ITERATIONS)
  } finally {
    dispatch.mockRestore()
    await runtime.dispose()
  }
})
