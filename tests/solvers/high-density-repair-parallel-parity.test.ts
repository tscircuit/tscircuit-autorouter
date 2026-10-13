import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { solveHighDensityRepairSample, type HighDensityRepairSampleInput, type HighDensityRepairSampleResult } from "lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"
import { createParallelRepairFixture } from "tests/fixtures/parallelRepairFixture"

test("parallel repair consumes out-of-order results deterministically with bounded dispatch", async () => {
  const fixture = createParallelRepairFixture()
  const original = structuredClone(fixture)
  const sequential = new Pipeline4HighDensityRepairSolver(fixture)
  sequential.solve()
  expect(sequential.solved).toBe(true)
  expect(sequential.getOutput()).not.toEqual(fixture.hdRoutes)
  for (const concurrency of [1, 2, 4, 10]) {
    const jobs: { input: HighDensityRepairSampleInput; resolve: (value: HighDensityRepairSampleResult) => void }[] = []
    let inFlight = 0
    let maxInFlight = 0
    const parallel = new Pipeline4HighDensityRepairSolver({
      ...structuredClone(original),
      parallelRepair: {
        concurrency,
        executor: (input): Promise<HighDensityRepairSampleResult> => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          return new Promise((resolve) => jobs.push({ input, resolve }))
        },
      },
    })
    expect(() => parallel.solve()).toThrow("solveAsync")
    let steps = 0
    while (!parallel.solved && !parallel.failed && steps++ < 100) {
      parallel.step()
      await Promise.resolve()
      const batch = jobs.splice(0).reverse()
      for (const job of batch) {
        const value = solveHighDensityRepairSample(job.input)
        // An executor may reuse/mutate its inputs after producing a result.
        job.input.sample.nodeHdRoutes!.length = 0
        inFlight -= 1
        job.resolve(value)
        await Promise.resolve()
      }
    }
    expect(parallel.solved).toBe(true)
    expect(parallel.failed).toBe(false)
    expect(maxInFlight).toBe(Math.min(concurrency, original.nodeWithPortPoints.length))
    expect(parallel.getOutput()).toEqual(sequential.getOutput())
    expect(JSON.stringify(parallel.getOutput())).toBe(JSON.stringify(sequential.getOutput()))
    expect(parallel.stats).toEqual(sequential.stats)
    expect(parallel.originalHdRoutes).toEqual(original.hdRoutes)
  }
})
