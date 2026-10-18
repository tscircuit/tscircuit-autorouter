import { expect, test } from "bun:test"
import { CooperativePipelineProbe } from "../fixtures/CooperativePipelineProbe"

test("Pipeline9 cooperative solve preserves an already completed solver", async (): Promise<void> => {
  const solver = new CooperativePipelineProbe({ stepCount: 1 })
  solver.solve()
  await solver.solveAsync()
  expect(solver.iterations).toBe(1)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
})
