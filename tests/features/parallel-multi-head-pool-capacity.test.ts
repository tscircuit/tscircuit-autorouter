import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant, MultiHeadHistoryJob, MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse, Pipeline9ParallelHighDensityNodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

type PoolMessage = Pipeline9LocalWorkerRequest | MultiHeadHistoryGrant | MultiHeadHistoryDelivery

class ControlledWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: PoolMessage[] = []
  terminated = false

  postMessage(message: PoolMessage): void {
    if (this.terminated) {
      throw new Error("Cannot send work to a terminated controlled worker")
    }
    this.messages.push(message)
  }

  emit(response: Pipeline9LocalWorkerResponse): void {
    const handler = this.onmessage
    if (!handler) {
      throw new Error("Controlled worker has no response handler")
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

function createOwnerJob(index: number): Pipeline9ParallelHighDensityNodeJob {
  return {
    kind: "highDensityNode", contextId: 1, nodePf: null,
    nodeWithPortPoints: createNetworkedNode({ nodeId: `owner${index}`, connectionName: `signal${index}` }),
    context: { connectivityNetMap: {}, connectivityIdToNetMap: {}, colorMap: {}, obstacles: [], viaDiameter: 0.3, traceWidth: 0.15,
      obstacleMargin: 0.15, effort: 1, layerCount: 2, allowBlindAndBuriedVias: false,
      preserveTerminalPcbPortIds: true, includeBoardObstacles: true, enableRegionalFallback: false },
  }
}

function latestTask(worker: ControlledWorker): Pipeline9LocalWorkerRequest {
  const tasks = worker.messages.filter((message): message is Pipeline9LocalWorkerRequest => "job" in message)
  const task = tasks.at(-1)
  if (!task) {
    throw new Error("Controlled worker has no assigned task")
  }
  return task
}

function latestGrant(worker: ControlledWorker): MultiHeadHistoryGrant {
  const grants = worker.messages.filter((message): message is MultiHeadHistoryGrant => "kind" in message && message.kind === "multiHeadHistoryGrant")
  const grant = grants.at(-1)
  if (!grant) {
    throw new Error("Controlled owner has no history grant")
  }
  return grant
}

test("history requests use only idle slots and keep queued independent work ahead of speculation", async (): Promise<void> => {
  const workers: ControlledWorker[] = []
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4,
    workerFactory: (): Worker => {
      if (workers.length === 4) {
        throw new Error("History speculation exceeded the four-worker limit")
      }
      const worker = new ControlledWorker()
      workers.push(worker)
      return worker as unknown as Worker
    },
  })
  try {
    const owners = Array.from({ length: 4 }, (_, index) => pool.run(createOwnerJob(index)))
    const queued = pool.run({ kind: "warmup" })
    expect(workers).toHaveLength(4)
    const owner = workers[0]!
    const taskId = latestTask(owner).taskId
    const jobs: MultiHeadHistoryJob[] = [10, 11].map((candidateId) => ({ kind: "multiHeadHistory", candidateId,
      params: { nodeWithPortPoints: createOwnerJob(candidateId).nodeWithPortPoints }, connectivityNetMap: {}, connectivityIdToNetMap: {} }))
    const result: MultiHeadHistoryResult = { kind: "multiHeadHistory",
      initial: { iterations: 0, maxIterations: 1000, solved: false, failed: false, error: null, progress: 0 },
      steps: [{ iterations: 1, maxIterations: 1000, solved: true, failed: false, error: null, progress: 0 }], solvedRoutes: [] }

    owner.emit({ kind: "requestMultiHeadHistories", taskId, requestId: 1, jobs })
    expect(latestGrant(owner).admittedCandidateIds).toEqual([])
    expect(pool.stats.historyJobsStarted).toBe(0)
    workers[1]!.emit({ taskId: latestTask(workers[1]!).taskId, ok: true, result: "owner1" })
    expect(latestTask(workers[1]!).job.kind).toBe("warmup")
    owner.emit({ kind: "requestMultiHeadHistories", taskId, requestId: 2, jobs })
    expect(latestGrant(owner).admittedCandidateIds).toEqual([])
    expect(pool.stats.historyRequestsDenied).toBe(2)

    workers[1]!.emit({ taskId: latestTask(workers[1]!).taskId, ok: true, result: "queued" })
    owner.emit({ kind: "requestMultiHeadHistories", taskId, requestId: 3, jobs })
    expect(latestGrant(owner).admittedCandidateIds).toEqual([10])
    expect(latestTask(workers[1]!).job.kind).toBe("multiHeadHistory")
    expect(workers).toHaveLength(4)
    workers[1]!.emit({ taskId: latestTask(workers[1]!).taskId, ok: true, result })
    await Promise.resolve()
    const firstDelivery = owner.messages.find((message): message is MultiHeadHistoryDelivery => "kind" in message && message.kind === "multiHeadHistoryDelivery")
    expect(firstDelivery).toMatchObject({ requestId: 3, candidateId: 10, ok: true, result })

    workers[2]!.emit({ taskId: latestTask(workers[2]!).taskId, ok: true, result: "owner2" })
    workers[3]!.emit({ taskId: latestTask(workers[3]!).taskId, ok: true, result: "owner3" })
    owner.emit({ kind: "requestMultiHeadHistories", taskId, requestId: 4, jobs })
    expect(latestGrant(owner).admittedCandidateIds).toEqual([10, 11])
    workers[2]!.emit({ taskId: latestTask(workers[2]!).taskId, ok: true, result })
    await Promise.resolve()
    workers[1]!.emit({ taskId: latestTask(workers[1]!).taskId, ok: true, result })
    await Promise.resolve()
    const deliveries = owner.messages.filter((message): message is MultiHeadHistoryDelivery => "kind" in message && message.kind === "multiHeadHistoryDelivery" && message.requestId === 4)
    expect(deliveries.map((delivery) => delivery.candidateId)).toEqual([11, 10])
    expect(pool.stats.historyRequestsGranted).toBe(2)
    expect(pool.stats.historyJobsStarted).toBe(3)
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(workers).toHaveLength(4)
    owner.emit({ taskId, ok: true, result: "owner0" })
    expect(await Promise.all(owners)).toEqual(["owner0", "owner1", "owner2", "owner3"])
    expect(await queued).toBe("queued")
    expect(pool.stats.tasksCompleted).toBe(pool.stats.tasksStarted)
  } finally {
    pool.dispose()
  }
})
