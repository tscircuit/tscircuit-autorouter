import { expect, test } from "bun:test"
import { CooperativePipelineProbe } from "../fixtures/CooperativePipelineProbe"

test("Pipeline9 cooperative solve stops when routing fails", async (): Promise<void> => {
  const solver = new CooperativePipelineProbe({ stepCount: 1024, failAt: 300 })
  await solver.solveAsync()
  expect(solver.iterations).toBe(300)
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe("Probe could not route")
  expect(solver.timeToSolve).toBeGreaterThanOrEqual(0)
})
