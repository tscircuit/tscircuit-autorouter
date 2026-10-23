import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils"
import { createJointRepairRuntimeFixture } from "../fixtures/createJointRepairRuntimeFixture"

test("finite joint-repair prefixes resume without publishing future worker results", async (): Promise<void> => {
  const runtime = new SolverRuntime()
  try {
    for (const limit of [0, 1, 4, 32, 256]) {
      const serial = createJointRepairRuntimeFixture(true)
      const parallel = createJointRepairRuntimeFixture(true)
      while (!serial.solved && !serial.failed && serial.iterations < limit)
        serial.step()
      await parallel.solveAsync(runtime, limit)
      expect(parallel.iterations).toBe(serial.iterations)
      expect(parallel.MAX_ITERATIONS).toBe(serial.MAX_ITERATIONS)
      expect(parallel.getCurrentPhase()).toBe(serial.getCurrentPhase())
      expect(parallel.activeSubSolver?.iterations).toBe(
        serial.activeSubSolver?.iterations,
      )
      expect(parallel.getOutput()).toEqual(serial.getOutput())
      serial.solve()
      await parallel.solveAsync(runtime)
      expect(parallel.getOutput()).toEqual(serial.getOutput())
      expect(parallel.iterations).toBe(serial.iterations)
      expect(parallel.MAX_ITERATIONS).toBe(serial.MAX_ITERATIONS)
    }
  } finally {
    await runtime.dispose()
  }
})
