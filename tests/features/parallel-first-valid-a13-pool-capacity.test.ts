import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { FirstValidA13CandidateDelivery, FirstValidA13CandidateGrant, FirstValidA13CandidateJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/firstValidA13CandidateTypes"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse, Pipeline9ParallelHighDensityNodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createFirstValidNode } from "tests/fixtures/first-valid-hd-fixtures"

type PoolMessage = Pipeline9LocalWorkerRequest | MultiHeadHistoryGrant | MultiHeadHistoryDelivery | FirstValidA13CandidateGrant | FirstValidA13CandidateDelivery

class A13PoolWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: PoolMessage[] = []
  terminated = false

  postMessage(message: PoolMessage): void {
    if (this.terminated) {
      throw new Error("Cannot post to terminated A13 pool worker")
    }
    this.messages.push(message)
  }

  emit(response: Pipeline9LocalWorkerResponse): void {
    const handler = this.onmessage
    if (!handler) {
      throw new Error("A13 pool worker has no response handler")
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

function latestTask(worker: A13PoolWorker): Pipeline9LocalWorkerRequest {
  const tasks = worker.messages.filter((message): message is Pipeline9LocalWorkerRequest => "job" in message)
  const task = tasks.at(-1)
  if (!task) {
    throw new Error("A13 pool worker has no assigned task")
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

test("A13 and both physical heads borrow at most three idle slots and cancel without delaying ordinary queued work", async (): Promise<void> => {
  const workers: A13PoolWorker[] = []
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, workerFactory: (): Worker => {
    if (workers.length >= 4) throw new Error("A13 created a fifth physical worker")
    const worker = new A13PoolWorker()
    workers.push(worker)
    return worker as unknown as Worker
  } })
  const job: FirstValidA13CandidateJob = { kind: "firstValidA13Candidate",
    params: { nodeWithPortPoints: createFirstValidNode(), traceWidth: 0.15, viaDiameter: 0.3 },
    connectivityNetMap: {}, connectivityIdToNetMap: {} }
  try {
    const ownerResult = pool.run(createOwnerJob())
    const owner = workers[0]!
    const ownerTaskId = latestTask(owner).taskId
    owner.emit({ kind: "requestFirstValidA13Candidate", taskId: ownerTaskId, requestId: 1, job })
    owner.emit({ kind: "requestMultiHeadHistories", taskId: ownerTaskId, requestId: 1,
      jobs: [0, 1].map((candidateId) => ({ kind: "multiHeadHistory", candidateId,
        params: { nodeWithPortPoints: createFirstValidNode() }, connectivityNetMap: {}, connectivityIdToNetMap: {} })) })
    expect(workers).toHaveLength(4)
    expect(pool.stats.maxActiveWorkers).toBe(4)
    const candidateTasks = workers.slice(1).map(latestTask)
    const flags = candidateTasks.map((task) => {
      if ((task.job.kind !== "multiHeadHistory" && task.job.kind !== "firstValidA13Candidate") || !task.job.cancellationBuffer) {
        throw new Error("Speculative job has no cancellation flag")
      }
      return new Int32Array(task.job.cancellationBuffer)
    })
    expect(candidateTasks.map((task) => task.job.kind)).toEqual(["firstValidA13Candidate", "multiHeadHistory", "multiHeadHistory"])
    const ordinaryResult = pool.run({ kind: "warmup" })
    owner.emit({ kind: "cancelFirstValidA13Candidate", taskId: ownerTaskId })
    expect(flags.map((flag) => Atomics.load(flag, 0))).toEqual([1, 1, 1])
    expect(pool.stats.a13CancellationSignals).toBe(1)
    expect(pool.stats.historyCancellationSignals).toBe(2)
    workers[1]!.emit({ taskId: candidateTasks[0]!.taskId, ok: true, result: {
      kind: "firstValidA13Candidate", status: "cancelled", iterations: 1,
      maxIterations: 100_000_000, routingIterations: 1000, sourceStats: {},
    } })
    expect(latestTask(workers[1]!).job.kind).toBe("warmup")
    workers[1]!.emit({ taskId: latestTask(workers[1]!).taskId, ok: true, result: null })
    await ordinaryResult
    expect(pool.stats.a13CandidatesStopped).toBe(1)
    expect(pool.stats.a13RoutingIterationsCompleted).toBe(1000)
    owner.emit({ taskId: ownerTaskId, ok: true, result: "winning owner" })
    expect(await ownerResult).toBe("winning owner")
    for (const [index, task] of candidateTasks.slice(1).entries()) {
      workers[index + 2]!.emit({ taskId: task.taskId, ok: true, result: {
        kind: "multiHeadHistory", initial: { iterations: 0, maxIterations: 1000,
          solved: false, failed: false, error: null, progress: 0 }, steps: [], solvedRoutes: [], cancelled: true,
      } })
    }
    await Promise.resolve()
    const owners = Array.from({ length: 4 }, () => pool.run(createOwnerJob()))
    const ownerTasks = workers.map(latestTask)
    for (const [index, worker] of workers.entries()) {
      worker.emit({ kind: "requestFirstValidA13Candidate", taskId: ownerTasks[index]!.taskId, requestId: 2, job })
      expect(worker.messages.at(-1)).toMatchObject({ kind: "firstValidA13CandidateGrant", admitted: false })
    }
    expect(pool.stats.a13RequestsDenied).toBe(4)
    const queued = pool.run({ kind: "warmup" })
    workers[0]!.emit({ taskId: ownerTasks[0]!.taskId, ok: true, result: "done" })
    expect(latestTask(workers[0]!).job.kind).toBe("warmup")
    workers[0]!.emit({ taskId: latestTask(workers[0]!).taskId, ok: true, result: null })
    for (let index = 1; index < 4; index++) workers[index]!.emit({ taskId: ownerTasks[index]!.taskId, ok: true, result: "done" })
    await Promise.all([...owners, queued])
    expect(workers).toHaveLength(4)
    expect(pool.stats.maxActiveWorkers).toBe(4)
  } finally {
    pool.dispose()
  }
})
