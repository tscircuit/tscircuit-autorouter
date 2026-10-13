import { expect, test } from "bun:test"
import { Worker } from "node:worker_threads"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import type { HighDensityRepairSampleResult } from "lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"
import { createParallelRepairFixture } from "tests/fixtures/parallelRepairFixture"

test("repair produces byte-identical output when samples run in separate workers", async () => {
  const fixture = createParallelRepairFixture()
  const sequential = new Pipeline4HighDensityRepairSolver(structuredClone(fixture))
  sequential.solve()
  const workers: Worker[] = []
  const parallel = new Pipeline4HighDensityRepairSolver({
    ...fixture,
    parallelRepair: {
      concurrency: 3,
      executor: (input): Promise<HighDensityRepairSampleResult> => {
        const worker = new Worker(new URL("../fixtures/parallelRepairWorker.ts", import.meta.url))
        workers.push(worker)
        return new Promise((resolve, reject) => {
          worker.once("message", (value: HighDensityRepairSampleResult): void => {
            resolve(value)
            void worker.terminate()
          })
          worker.once("error", reject)
          worker.postMessage(input)
        })
      },
    },
  })
  try {
    await parallel.solveAsync()
    expect(parallel.solved).toBe(true)
    expect(parallel.failed).toBe(false)
    expect(workers).toHaveLength(fixture.nodeWithPortPoints.length)
    expect(JSON.stringify(parallel.getOutput())).toBe(JSON.stringify(sequential.getOutput()))
    expect(parallel.stats).toEqual(sequential.stats)
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()))
  }
})
