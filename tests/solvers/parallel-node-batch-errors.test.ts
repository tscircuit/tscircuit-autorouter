import { expect, spyOn, test } from "bun:test"
import { HighDensityForceImproveSolver as WorkerForceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/force-improvement-fork/HighDensityForceImproveSolver"
import { ParallelHighDensityForceImproveSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelHighDensityForceImproveSolver"
import { ParallelHighDensityRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/ParallelHighDensityRepairSolver"
import { executeParallelStageJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerJobs"
import type { ParallelStageWorkerJob, ParallelStageWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import { createParallelNodeBatchFixture } from "tests/fixtures/parallel-node-batch-fixtures"

test("batch child exceptions stop subsequent children and rejected stages retain error identity without partial commits", async (): Promise<void> => {
  const fixture = createParallelNodeBatchFixture()
  const failure = new Error("deliberate batch child failure")
  const visited: string[] = []
  const originalStep = WorkerForceSolver.prototype._step
  const forceStep = spyOn(WorkerForceSolver.prototype, "_step").mockImplementation(function (this: WorkerForceSolver): void {
    const nodeId = this.originalNodeWithPortPoints[0]!.capacityMeshNodeId
    visited.push(nodeId)
    if (nodeId === fixture.nodes[1]!.capacityMeshNodeId) throw failure
    originalStep.call(this)
  })
  try {
    let caught: unknown
    try {
      executeParallelStageJob({ kind: "forceImproveNodeBatch",
        jobs: fixture.forceJobs.slice(0, 3).map((job, entryIndex) => ({ entryIndex, job })) })
    } catch (error: unknown) {
      caught = error
    }
    expect(caught).toBe(failure)
    expect(visited).toEqual(fixture.nodes.slice(0, 2).map((node) => node.capacityMeshNodeId))
  } finally {
    forceStep.mockRestore()
  }
  const submitted: ParallelStageWorkerJob[] = []
  const pool: ParallelStageWorkerPool = {
    workerCount: 4,
    async run<T>(job: ParallelStageWorkerJob): Promise<T> {
      submitted.push(job)
      if (job.kind === "forceImproveNodeBatch" || job.kind === "repairNodeBatch") {
        throw failure
      }
      return executeParallelStageJob(job) as T
    },
  }
  const force = new ParallelHighDensityForceImproveSolver({ nodeWithPortPoints: fixture.nodes,
    hdRoutes: fixture.routes, totalStepsPerNode: 0, workerPool: pool })
  await expect(force.solveAsync()).rejects.toBe(failure)
  expect(submitted.some((job) => job.kind === "forceImproveNodeBatch")).toBe(true)
  expect(force.failed).toBe(true)
  expect(force.solved).toBe(false)
  expect(force.error).toContain(failure.message)
  expect(force.improvedRoutesByIndex.size).toBe(0)
  expect(force.activeSampleIndex).toBe(0)
  const repair = new ParallelHighDensityRepairSolver({ nodeWithPortPoints: fixture.nodes,
    hdRoutes: fixture.routes, obstacles: [], repairMargin: 0.2, workerPool: pool })
  await expect(repair.solveAsync()).rejects.toBe(failure)
  expect(submitted.some((job) => job.kind === "repairNodeBatch")).toBe(true)
  expect(repair.failed).toBe(true)
  expect(repair.solved).toBe(false)
  expect(repair.error).toContain(failure.message)
  expect(repair.repairedRoutesByIndex.size).toBe(0)
  expect(repair.activeSampleIndex).toBe(0)
})
