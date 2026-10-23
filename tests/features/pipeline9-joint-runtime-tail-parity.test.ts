import { expect, spyOn, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { createJointRepairRuntimeFixture } from "../fixtures/createJointRepairRuntimeFixture"

test("speculative repair retains the serial tail output and logical budget", async (): Promise<void> => {
  const serial = createJointRepairRuntimeFixture(true)
  const parallel = createJointRepairRuntimeFixture(true)
  const runtime = new SolverRuntime()
  const dispatch = spyOn(runtime, "executeAsync")
  try {
    serial.solve()
    await parallel.solveAsync(runtime)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(parallel.stats.initialBoundedRegionalRepairAccepted).toBeFalse()
    expect(parallel.solved).toBeTrue()
    expect(parallel.failed).toBeFalse()
    expect(parallel.getOutput()).toEqual(serial.getOutput())
    expect(parallel.getUpdatedPreloadedTraces()).toEqual(
      serial.getUpdatedPreloadedTraces(),
    )
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.MAX_ITERATIONS).toBe(serial.MAX_ITERATIONS)
    expect(parallel.progress).toBe(serial.progress)
    expect(parallel.getCurrentPhase()).toBe(serial.getCurrentPhase())
    expect(parallel.visualize()).toEqual(serial.visualize())
  } finally {
    dispatch.mockRestore()
    await runtime.dispose()
  }
})
