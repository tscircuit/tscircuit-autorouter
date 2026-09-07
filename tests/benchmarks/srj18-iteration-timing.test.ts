import { expect, test } from "bun:test"
import { runSrj18IterationTiming } from "../../scripts/benchmark/srj18-iteration-timing"

// This performance test gets a dedicated serial Blacksmith job. Keep ordinary
// parallel test shards from producing noisy wall-clock warnings and duplicate work.
test.skipIf(process.env.SRJ18_ITERATION_TIMING !== "1")(
  "the fastest SRJ18 sample reports slow iterations by deepest active solver",
  async (): Promise<void> => {
    const result = await runSrj18IterationTiming()
    expect(result.failed).toBe(false)
    expect(result.solved).toBe(true)
    expect(result.totalIterations).toBeGreaterThan(0)
  },
)
