import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { solveHighDensityRepairSample, type HighDensityRepairSampleResult } from "lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"
import { createParallelRepairFixture } from "tests/fixtures/parallelRepairFixture"

test("parallel repair preserves the sequential stage iteration budget and partial output", async () => {
  const fixture = createParallelRepairFixture()
  for (const limit of [0, 1, 2, 3, 5, 8, 12, 20, 50, 100]) {
    const sequential = new Pipeline4HighDensityRepairSolver(structuredClone(fixture))
    sequential.MAX_ITERATIONS = limit
    sequential.solve()
    const parallel = new Pipeline4HighDensityRepairSolver({
      ...structuredClone(fixture),
      parallelRepair: { concurrency: 3, executor: async (input) => solveHighDensityRepairSample(input) },
    })
    parallel.MAX_ITERATIONS = limit
    await parallel.solveAsync()
    expect({ limit, solved: parallel.solved, failed: parallel.failed }).toEqual({ limit, solved: sequential.solved, failed: sequential.failed })
    expect(parallel.getOutput()).toEqual(sequential.getOutput())
    expect(parallel.stats).toEqual(sequential.stats)
    expect(parallel.error).toBe(sequential.error)
  }
  const exhausted = new Pipeline4HighDensityRepairSolver({
    ...structuredClone(fixture),
    parallelRepair: {
      executor: (): Promise<HighDensityRepairSampleResult> => new Promise(() => {}),
    },
  })
  exhausted.MAX_ITERATIONS = 0
  await exhausted.solveAsync()
  expect(exhausted.failed).toBe(true)
  expect(exhausted.getOutput()).toEqual(fixture.hdRoutes)
})
