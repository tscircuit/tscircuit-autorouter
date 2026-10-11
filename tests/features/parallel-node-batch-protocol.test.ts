import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { executeParallelStageJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerJobs"
import type { ParallelNodeBatchJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelStageWorkerTypes"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createParallelNodeBatchFixture } from "tests/fixtures/parallel-node-batch-fixtures"

class BatchProtocolWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: Pipeline9LocalWorkerRequest[] = []
  terminated = false

  postMessage(request: Pipeline9LocalWorkerRequest): void {
    if (this.terminated) {
      throw new Error("Batch protocol worker was terminated")
    }
    this.requests.push(request)
  }

  emit(result: unknown): void {
    const request = this.requests.at(-1)
    if (!request || !this.onmessage) throw new Error("Batch protocol worker has no request")
    const response: Pipeline9LocalWorkerResponse = { taskId: request.taskId, ok: true, result }
    this.onmessage(new MessageEvent("message", { data: response }))
  }

  terminate(): void {
    this.terminated = true
    this.onmessage = null
    this.onerror = null
    this.requests.length = 0
  }
}

test("malformed force and repair batch responses reject all pool work before any result resolves", async (): Promise<void> => {
  const fixture = createParallelNodeBatchFixture(2)
  const jobs: ParallelNodeBatchJob[] = [
    { kind: "forceImproveNodeBatch", jobs: fixture.forceJobs.map((job, entryIndex) => ({ entryIndex, job })) },
    { kind: "repairNodeBatch", jobs: fixture.repairJobs.map((job, entryIndex) => ({ entryIndex, job })) },
  ]
  for (const job of jobs) {
    const valid = executeParallelStageJob(job)
    if (valid.kind !== "forceImproveNodeBatch" && valid.kind !== "repairNodeBatch") throw new Error("Expected batch result")
    const malformed = [
      { ...valid, kind: "wrong" },
      { ...valid, results: valid.results.slice(1) },
      { ...valid, results: [...valid.results].reverse() },
      { ...valid, results: [{ ...valid.results[0]!, entryIndex: 99 }, valid.results[1]!] },
      { ...valid, results: [{ ...valid.results[0]!, result: { kind: "wrong" } }, valid.results[1]!] },
      { ...valid, results: [{ ...valid.results[0]!, result: job.kind === "forceImproveNodeBatch"
        ? { kind: "forceImproveNode", routes: [] } : { kind: "repairNode", repairedRoutes: [], stats: [] } }, valid.results[1]!] },
    ]
    for (const result of malformed) {
      const workers: BatchProtocolWorker[] = []
      const pool = new Pipeline9LocalWorkerPool({ workerCount: 2, workerFactory: (): Worker => {
        const worker = new BatchProtocolWorker()
        workers.push(worker)
        return worker as unknown as Worker
      } })
      try {
        const pending = [pool.run(job), pool.run({ kind: "warmup" }), pool.run({ kind: "warmup" })]
        const observed = Promise.allSettled(pending)
        workers[0]!.emit(result)
        const outcomes = await observed
        expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true)
        const errors = outcomes.map((outcome) => {
          if (outcome.status !== "rejected") throw new Error("Malformed batch unexpectedly resolved")
          return outcome.reason
        })
        expect(errors[0]).toBeInstanceOf(Error)
        expect(errors[1]).toBe(errors[0])
        expect(errors[2]).toBe(errors[0])
        expect(workers.every((worker) => worker.terminated)).toBe(true)
        expect(pool.stats.tasksCompleted).toBe(0)
        await expect(pool.run({ kind: "warmup" })).rejects.toBe(errors[0])
        expect(pool.stats.maxActiveWorkers).toBe(2)
      } finally {
        pool.dispose()
      }
    }
  }
})
