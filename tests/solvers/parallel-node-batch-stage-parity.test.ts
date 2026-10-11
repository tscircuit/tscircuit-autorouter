import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { ParallelHighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelHighDensityForceImproveSolver"
import { ParallelHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelHighDensityRepairSolver"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { Pipeline9LocalWorkerJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { createParallelNodeBatchFixture } from "tests/fixtures/parallel-node-batch-fixtures"

type HeldResponse = { ordinal: number; result: unknown; resolve: (result: unknown) => void }

test("four workers batch light force and repair nodes and commit exact metadata and stats after reverse delivery", async (): Promise<void> => {
  const fixture = createParallelNodeBatchFixture()
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    await pool.warmup()
    const originalRun = pool.run.bind(pool)
    let submitted: Pipeline9LocalWorkerJob[] = []
    let held: HeldResponse[] = []
    let deliveryOrder: number[] = []
    pool.run = <T>(job: Pipeline9LocalWorkerJob): Promise<T> => {
      const ordinal = submitted.length
      submitted.push(job)
      return originalRun<T>(job).then((result) => new Promise<T>((resolve) => {
        held.push({ ordinal, result, resolve: resolve as (value: unknown) => void })
        if (held.length === submitted.length) {
          held.sort((left, right) => right.ordinal - left.ordinal)
          for (const response of held) {
            deliveryOrder.push(response.ordinal)
            response.resolve(response.result)
          }
        }
      }))
    }
    const forceParams = { nodeWithPortPoints: fixture.nodes, hdRoutes: fixture.routes,
      totalStepsPerNode: 0, nodeAssignmentMargin: 0.2 }
    const serialForce = new HighDensityForceImproveSolver(structuredClone(forceParams))
    serialForce.solve()
    const parallelForce = new ParallelHighDensityForceImproveSolver({ ...structuredClone(forceParams), workerPool: pool })
    await parallelForce.solveAsync()
    expect(parallelForce.solved).toBe(true)
    expect(parallelForce.getOutput()).toEqual(serialForce.getOutput())
    expect(parallelForce.stats).toEqual(serialForce.stats)
    expect([...parallelForce.improvedRoutesByIndex.keys()]).toEqual([...serialForce.improvedRoutesByIndex.keys()])
    expect(submitted.some((job) => job.kind === "forceImproveNodeBatch")).toBe(true)
    expect(submitted.some((job) => job.kind === "forceImproveNode")).toBe(true)
    expect(submitted.length).toBeLessThan(fixture.routes.length)
    expect(deliveryOrder).toEqual(Array.from({ length: submitted.length }, (_, index) => submitted.length - 1 - index))
    for (const job of submitted) {
      if (job.kind === "forceImproveNodeBatch") expect(job.jobs.length).toBeLessThanOrEqual(64)
    }
    submitted = []
    held = []
    deliveryOrder = []
    const repairParams = { nodeWithPortPoints: fixture.nodes, hdRoutes: serialForce.getOutput(),
      obstacles: [], repairMargin: 0.2 }
    const serialRepair = new Pipeline4HighDensityRepairSolver(structuredClone(repairParams))
    serialRepair.solve()
    const parallelRepair = new ParallelHighDensityRepairSolver({ ...structuredClone(repairParams), workerPool: pool })
    await parallelRepair.solveAsync()
    expect(parallelRepair.solved).toBe(true)
    expect(parallelRepair.getOutput()).toEqual(serialRepair.getOutput())
    expect(parallelRepair.stats).toEqual(serialRepair.stats)
    expect([...parallelRepair.repairedRoutesByIndex.keys()]).toEqual([...serialRepair.repairedRoutesByIndex.keys()])
    expect(submitted.some((job) => job.kind === "repairNodeBatch")).toBe(true)
    expect(submitted.some((job) => job.kind === "repairNode")).toBe(true)
    expect(submitted.length).toBeLessThan(fixture.routes.length)
    expect(deliveryOrder).toEqual(Array.from({ length: submitted.length }, (_, index) => submitted.length - 1 - index))
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(parallelRepair.getOutput().map((route) => [route.startPcbPortId, route.endPcbPortId, route.rootConnectionName]))
      .toEqual(fixture.routes.map((route) => [route.startPcbPortId, route.endPcbPortId, route.rootConnectionName]))
  } finally {
    pool.dispose()
  }
})
