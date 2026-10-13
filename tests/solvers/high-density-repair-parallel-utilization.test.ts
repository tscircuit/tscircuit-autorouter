import { expect, test } from "bun:test"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { solveHighDensityRepairSample, type HighDensityRepairSampleInput, type HighDensityRepairSampleResult } from "lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"
import { createParallelRepairFixture } from "tests/fixtures/parallelRepairFixture"

test("a slow earlier node does not prevent completed workers from receiving more repair work", async () => {
  const fixture = createParallelRepairFixture()
  const sequential = new Pipeline4HighDensityRepairSolver(structuredClone(fixture))
  sequential.solve()
  const jobs: { input: HighDensityRepairSampleInput; resolve: (value: HighDensityRepairSampleResult) => void }[] = []
  const repair = new Pipeline4HighDensityRepairSolver({
    ...fixture,
    parallelRepair: {
      concurrency: 2,
      executor: (input): Promise<HighDensityRepairSampleResult> => new Promise((resolve) => jobs.push({ input, resolve })),
    },
  })
  repair.step()
  await Promise.resolve()
  expect(jobs).toHaveLength(2)
  for (let index = 1; index < fixture.nodeWithPortPoints.length; index++) {
    const completed = jobs[index]
    completed.resolve(solveHighDensityRepairSample(completed.input))
    await Promise.race(repair.pendingEffects!.map((effect) => effect.promise))
    repair.step()
    await Promise.resolve()
    expect(repair.stats.repairedNodeCount).toBe(0)
    expect(jobs).toHaveLength(Math.min(index + 2, fixture.nodeWithPortPoints.length))
  }
  jobs[0].resolve(solveHighDensityRepairSample(jobs[0].input))
  await repair.solveAsync()
  expect(repair.solved).toBe(true)
  expect(repair.getOutput()).toEqual(sequential.getOutput())
  expect(repair.stats).toEqual(sequential.stats)
})
