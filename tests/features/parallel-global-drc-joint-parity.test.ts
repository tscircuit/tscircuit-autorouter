import { expect, test } from "bun:test"
import { ParallelPipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelPipeline9JointDrcRepairSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createParallelGlobalDrcFixture } from "../fixtures/parallel-global-drc-fixture"

function readLogicalStats(solver: Pipeline9JointDrcRepairSolver): unknown {
  const logical: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(solver.stats)) {
    if (key.includes("Time") || key.includes("time") || key.endsWith("Ms")) continue
    logical[key] = value
  }
  return logical
}

test("parallel global force frontiers preserve native Joint routes, preload ownership, counters and caps", async (): Promise<void> => {
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    for (const withPreload of [false, true]) {
      const native = new Pipeline9JointDrcRepairSolver(createParallelGlobalDrcFixture(withPreload))
      const parallel = new ParallelPipeline9JointDrcRepairSolver({
        ...createParallelGlobalDrcFixture(withPreload), workerPool: pool,
      })
      native.solve()
      await parallel.solveAsync()
      expect(native.solved, native.error ?? "").toBe(true)
      expect(parallel.solved, parallel.error ?? "").toBe(true)
      expect(parallel.failed).toBe(native.failed)
      expect(parallel.getOutput()).toEqual(native.getOutput())
      expect(parallel.getUpdatedPreloadedTraces()).toEqual(native.getUpdatedPreloadedTraces())
      expect(parallel.exactRepairSolver!.stats).toEqual(native.exactRepairSolver!.stats)
      expect(parallel.exactRepairSolver!.iterations).toBe(native.exactRepairSolver!.iterations)
      expect(parallel.exactRepairSolver!.MAX_ITERATIONS).toBe(native.exactRepairSolver!.MAX_ITERATIONS)
      expect(readLogicalStats(parallel)).toEqual(readLogicalStats(native))
    }
    expect(pool.stats.tasksStarted).toBeGreaterThan(4)
    expect(pool.stats.tasksCompleted).toBe(pool.stats.tasksStarted)
    expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
    expect(pool.stats.maxActiveWorkers).toBeGreaterThan(1)
  } finally {
    pool.dispose()
  }
})
