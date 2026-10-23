import { expect, test } from "bun:test"
import { SolverRuntime } from "@tscircuit/solver-utils/runtime/node"
import { createJointRepairRuntimeFixture } from "../fixtures/createJointRepairRuntimeFixture"

test("four real workers preserve joint repair output and logical iterations", async (): Promise<void> => {
  const serial = createJointRepairRuntimeFixture(true)
  const parallel = createJointRepairRuntimeFixture(true)
  const runtime = new SolverRuntime({
    workerCount: 4,
    workerUrl: new URL(
      "../fixtures/pipeline9SolverRuntime.worker.ts",
      import.meta.url,
    ),
    requireWorker: true,
  })
  try {
    serial.solve()
    await parallel.solveAsync(runtime)
    expect(parallel.solved).toBeTrue()
    expect(parallel.failed).toBeFalse()
    expect(parallel.getOutput()).toEqual(serial.getOutput())
    expect(parallel.iterations).toBe(serial.iterations)
    expect(parallel.MAX_ITERATIONS).toBe(serial.MAX_ITERATIONS)
    expect(parallel.visualize()).toEqual(serial.visualize())
  } finally {
    await runtime.dispose()
  }
})
