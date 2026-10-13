import { expect, test } from "bun:test"
import { ParallelRepairWorkerPool } from "scripts/benchmark/ParallelRepairWorkerPool"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createParallelRepairFixture } from "tests/fixtures/parallelRepairFixture"
import type { HighDensityRepairSampleInput, HighDensityRepairSampleResult } from "lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"

test("the benchmark reuses worker threads and preserves repair output across pool widths", async () => {
  const pool = new ParallelRepairWorkerPool(2)
  try {
    const metadata = await pool.ready
    expect(metadata).toHaveLength(2)
    expect(new Set(metadata.map((worker) => worker.threadId)).size).toBe(2)
    const fixture = createParallelRepairFixture()
    const sequential = new Pipeline4HighDensityRepairSolver(structuredClone(fixture))
    sequential.solve()
    for (const concurrency of [1, 2, 1, 2]) {
      const repair = new Pipeline4HighDensityRepairSolver({
        ...structuredClone(fixture),
        parallelRepair: {
          concurrency,
          executor: (input: HighDensityRepairSampleInput): Promise<HighDensityRepairSampleResult> => pool.execute(input),
        },
      })
      await repair.solveAsync()
      expect(repair.solved).toBe(true)
      expect(JSON.stringify(repair.getOutput())).toBe(JSON.stringify(sequential.getOutput()))
      expect(repair.stats).toEqual(sequential.stats)
    }
  } finally {
    await pool.close()
  }
})
