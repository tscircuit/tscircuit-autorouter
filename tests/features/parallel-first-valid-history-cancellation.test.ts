import { expect, spyOn, test } from "bun:test"
import { executeMultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeMultiHeadHistoryJob"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant, MultiHeadHistoryJob, MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse, Pipeline9ParallelHighDensityNodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { createFirstValidNode } from "tests/fixtures/first-valid-hd-fixtures"

type PoolMessage = Pipeline9LocalWorkerRequest | MultiHeadHistoryGrant | MultiHeadHistoryDelivery

class CancellationWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: PoolMessage[] = []
  terminated = false

  postMessage(message: PoolMessage): void {
    if (this.terminated) {
      throw new Error("Cannot send work to a terminated cancellation worker")
    }
    this.messages.push(message)
  }

  emit(response: Pipeline9LocalWorkerResponse): void {
    const handler = this.onmessage
    if (!handler) {
      throw new Error("Cancellation worker has no response handler")
    }
    handler(new MessageEvent("message", { data: response }))
  }

  terminate(): void {
    this.terminated = true
    this.onmessage = null
    this.onerror = null
    this.messages.length = 0
  }
}

function latestTask(worker: CancellationWorker): Pipeline9LocalWorkerRequest {
  const tasks = worker.messages.filter((message): message is Pipeline9LocalWorkerRequest => "job" in message)
  const task = tasks.at(-1)
  if (!task) {
    throw new Error("Cancellation worker has no assigned task")
  }
  return task
}

function createOwnerJob(): Pipeline9ParallelHighDensityNodeJob {
  return { kind: "highDensityNode", contextId: 1, nodePf: null, nodeWithPortPoints: createFirstValidNode(),
    context: { connectivityNetMap: {}, connectivityIdToNetMap: {}, colorMap: {}, obstacles: [],
      viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1, layerCount: 2,
      allowBlindAndBuriedVias: false, preserveTerminalPcbPortIds: true, includeBoardObstacles: true,
      enableRegionalFallback: false, highDensityPolicy: "first-valid" },
  }
}

test("early winners and completed owners cancel unused histories between steps without extra workers", async (): Promise<void> => {
  const cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  const job: MultiHeadHistoryJob = { kind: "multiHeadHistory", candidateId: 0,
    params: { nodeWithPortPoints: createFirstValidNode(), hyperParameters: { SEGMENTS_PER_POLYLINE: 6 } },
    connectivityNetMap: {}, connectivityIdToNetMap: {}, cancellationBuffer: cancellation.buffer as SharedArrayBuffer }
  const originalStep = MultiHeadPolyLineIntraNodeSolver3.prototype._step
  const step = spyOn(MultiHeadPolyLineIntraNodeSolver3.prototype, "_step").mockImplementation(function (this: MultiHeadPolyLineIntraNodeSolver3): void {
    originalStep.call(this)
    Atomics.store(cancellation, 0, 1)
    expect(this.solved).toBe(false)
    expect(this.failed).toBe(false)
  })
  let result: MultiHeadHistoryResult
  try {
    result = executeMultiHeadHistoryJob(job)
    expect(result.cancelled).toBe(true)
    expect(result.steps).toHaveLength(1)
    expect(result.solvedRoutes).toEqual([])
  } finally {
    step.mockRestore()
  }
  const workers: CancellationWorker[] = []
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 3, workerFactory: (): Worker => {
    if (workers.length >= 3) throw new Error("Cancellation created another physical worker")
    const worker = new CancellationWorker()
    workers.push(worker)
    return worker as unknown as Worker
  } })
  try {
    const ownerPromise = pool.run(createOwnerJob())
    const owner = workers[0]!
    const ownerTaskId = latestTask(owner).taskId
    owner.emit({ kind: "requestMultiHeadHistories", taskId: ownerTaskId, requestId: 1,
      jobs: [0, 1].map((candidateId) => ({ ...job, candidateId, cancellationBuffer: undefined })) })
    expect(workers).toHaveLength(3)
    const tasks = workers.slice(1).map(latestTask)
    const flags = tasks.map((task) => {
      if (task.job.kind !== "multiHeadHistory" || !task.job.cancellationBuffer) throw new Error("History job has no cancellation flag")
      return new Int32Array(task.job.cancellationBuffer)
    })
    expect(flags.map((flag) => Atomics.load(flag, 0))).toEqual([0, 0])
    const queued = pool.run({ kind: "warmup" })
    owner.emit({ kind: "cancelMultiHeadHistories", taskId: ownerTaskId })
    expect(flags.map((flag) => Atomics.load(flag, 0))).toEqual([1, 1])
    expect(pool.stats.historyCancellationSignals).toBe(2)
    workers[1]!.emit({ taskId: tasks[0]!.taskId, ok: true, result })
    expect(latestTask(workers[1]!).job.kind).toBe("warmup")
    workers[1]!.emit({ taskId: latestTask(workers[1]!).taskId, ok: true, result: null })
    await queued
    owner.emit({ taskId: ownerTaskId, ok: true, result: "owner finished" })
    expect(await ownerPromise).toBe("owner finished")
    workers[2]!.emit({ taskId: tasks[1]!.taskId, ok: true, result })
    await Promise.resolve()
    expect(pool.stats.maxActiveWorkers).toBe(3)
    expect(workers).toHaveLength(3)
    const ordinaryOwner = pool.run(createOwnerJob())
    const nextOwnerTaskId = latestTask(owner).taskId
    owner.emit({ kind: "requestMultiHeadHistories", taskId: nextOwnerTaskId, requestId: 2,
      jobs: [{ ...job, cancellationBuffer: undefined }] })
    const nextHistoryTask = latestTask(workers[1]!)
    if (nextHistoryTask.job.kind !== "multiHeadHistory" || !nextHistoryTask.job.cancellationBuffer) throw new Error("Missing next cancellation flag")
    const nextFlag = new Int32Array(nextHistoryTask.job.cancellationBuffer)
    owner.emit({ taskId: nextOwnerTaskId, ok: true, result: "generic winner" })
    expect(await ordinaryOwner).toBe("generic winner")
    expect(Atomics.load(nextFlag, 0)).toBe(1)
    expect(pool.stats.historyCancellationSignals).toBe(3)
    workers[1]!.emit({ taskId: nextHistoryTask.taskId, ok: true, result })
    await Promise.resolve()
  } finally {
    pool.dispose()
  }
})
