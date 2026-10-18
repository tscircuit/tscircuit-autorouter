import { expect, spyOn, test } from "bun:test"
import { CooperativePipelineProbe } from "../fixtures/CooperativePipelineProbe"

test("Pipeline9 cooperative solve lets timers run before routing finishes", async (): Promise<void> => {
  const solver = new CooperativePipelineProbe({ stepCount: 1024 })
  let elapsedMs = 0
  const clock = spyOn(performance, "now").mockImplementation((): number => {
    elapsedMs += 125
    return elapsedMs
  })
  let stepsWhenTimerRan: number | undefined
  const timer = setTimeout((): void => {
    stepsWhenTimerRan = solver.iterations
  }, 0)
  try {
    await solver.solveAsync()
    expect(stepsWhenTimerRan).toBeGreaterThan(0)
    expect(stepsWhenTimerRan).toBeLessThan(1024)
    expect(solver.iterations).toBe(1024)
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.timeToSolve).toBeGreaterThanOrEqual(0)
  } finally {
    clearTimeout(timer)
    clock.mockRestore()
  }
})
