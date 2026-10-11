import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { executeParallelGlobalDrcTrial } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeParallelGlobalDrcTrial"
import type { ParallelGlobalDrcTrialJob, ParallelGlobalDrcTrialResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGlobalDrcTrialTypes"
import type { Pipeline9LocalWorkerRequest } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createParallelGlobalDrcFixture } from "../fixtures/parallel-global-drc-fixture"

class SnapshotJoint extends Pipeline9JointDrcRepairSolver {
  makeJob(version: number, trialIndex: number): ParallelGlobalDrcTrialJob {
    const context = this.getPreparedIndexedDrcContext()
    if (!context) throw new Error("Global DRC snapshot fixture has no evaluation context")
    const routes = structuredClone(this.exactRepairSolver!.params.hdRoutes)
    for (const point of routes[0]!.route) point.y += version * 0.05
    const evaluation = this.exactRepairSolver!.params.drcEvaluator!({ routes, traces: [] })
    const errors = Array.isArray(evaluation) ? evaluation : evaluation.errorsWithCenters ?? evaluation.errors
    const error = errors[0]
    if (!error) throw new Error("Global DRC snapshot fixture has no initial routing violation")
    return { kind: "globalDrcForceTrial", contextId: 100_000 + version,
      context, snapshotId: 200_000 + version, snapshot: { srj: context.engineSrj, hdRoutes: routes },
      trial: { kind: "safe-trace-layer", trialIndex, error,
        changedRouteIndex: 0, targetZ: 1, spanExpansion: "full", directionVariant: trialIndex % 4 } }
  }
}

test("four actual workers cache immutable force frontier snapshots and refresh every new geometry/context", async (): Promise<void> => {
  const requests: Pipeline9LocalWorkerRequest[][] = []
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, workerFactory: (url: URL): Worker => {
    const worker = new Worker(url, { type: "module" })
    const sent: Pipeline9LocalWorkerRequest[] = []
    requests.push(sent)
    const postMessage = worker.postMessage.bind(worker)
    worker.postMessage = (request: Pipeline9LocalWorkerRequest): void => {
      sent.push(request)
      postMessage(request)
    }
    return worker
  } })
  try {
    const fixture = new SnapshotJoint(createParallelGlobalDrcFixture(false))
    for (const version of [0, 1, 2]) {
      const jobs = Array.from({ length: 8 }, (_, index) => fixture.makeJob(version, index))
      const expected = jobs.map((job) => executeParallelGlobalDrcTrial(job))
      const results = await Promise.all(jobs.map((job) => pool.run<ParallelGlobalDrcTrialResult>(job)))
      expect(results).toEqual(expected)
      for (const sent of requests) {
        const frontier = sent.filter((request) => request.job.kind === "globalDrcForceTrial" && request.job.snapshotId === jobs[0]!.snapshotId)
        expect(frontier.length).toBeGreaterThanOrEqual(1)
        expect(frontier[0]!.job).toHaveProperty("context")
        expect(frontier[0]!.job).toHaveProperty("snapshot")
        for (const subsequent of frontier.slice(1)) {
          expect(subsequent.job).not.toHaveProperty("context")
          expect(subsequent.job).not.toHaveProperty("snapshot")
        }
      }
    }
    expect(pool.stats.tasksCompleted).toBe(24)
    expect(pool.stats.tasksStarted).toBe(24)
    expect(pool.stats.maxActiveWorkers).toBe(4)
  } finally {
    pool.dispose()
  }
  for (const omit of ["context", "snapshot"] as const) {
    const missing = new SnapshotJoint(createParallelGlobalDrcFixture(false)).makeJob(3, 0)
    delete missing[omit]
    const emptyPool = new Pipeline9LocalWorkerPool({ workerCount: 1 })
    try {
      await expect(emptyPool.run(missing)).rejects.toThrow(omit === "context" ? "needs context" : "needs snapshot")
      expect(emptyPool.stats.tasksStarted).toBe(0)
    } finally {
      emptyPool.dispose()
    }
  }
})
