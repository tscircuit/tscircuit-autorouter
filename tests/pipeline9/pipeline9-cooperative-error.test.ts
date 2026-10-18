import { expect, spyOn, test } from "bun:test"
import { CooperativePipelineProbe } from "../fixtures/CooperativePipelineProbe"

test("Pipeline9 cooperative solve propagates step errors", async (): Promise<void> => {
  const solver = new CooperativePipelineProbe({ stepCount: 1024, throwAt: 300 })
  let elapsedMs = 0
  const clock = spyOn(performance, "now").mockImplementation((): number => {
    elapsedMs += 125
    return elapsedMs
  })
  let timerRan = false
  const timer = setTimeout((): void => {
    timerRan = true
  }, 0)
  try {
    await expect(solver.solveAsync()).rejects.toThrow("Probe step failed")
    expect(timerRan).toBe(true)
    expect(solver.iterations).toBe(300)
    expect(solver.solved).toBe(false)
    expect(solver.failed).toBe(true)
    expect(solver.error).toContain("Probe step failed")
  } finally {
    clearTimeout(timer)
    clock.mockRestore()
  }
})
