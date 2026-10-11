import { expect, test } from "bun:test"
import { MultiHeadHistoryWorkerClient } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/MultiHeadHistoryWorkerClient"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { ParallelHighDensityNodeBatchJob, ParallelHighDensityNodeBatchResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityNodeBatching"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant, MultiHeadHistoryJob, MultiHeadHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

type PoolMessage = Pipeline9LocalWorkerRequest | MultiHeadHistoryGrant | MultiHeadHistoryDelivery
class ControlledHistoryBatchWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: PoolMessage[] = []
  client?: MultiHeadHistoryWorkerClient
  postMessage(message: PoolMessage): void {
    this.messages.push(message)
    if ("kind" in message && this.client) this.client.receive(message)
  }
  emit(response: Pipeline9LocalWorkerResponse): void {
    if (!this.onmessage) throw new Error("History batch fixture has no active worker")
    this.onmessage(new MessageEvent("message", { data: response }))
  }
  terminate(): void { this.onmessage = null; this.onerror = null }
  task(): Pipeline9LocalWorkerRequest {
    const request = this.messages.filter((message): message is Pipeline9LocalWorkerRequest => "job" in message).at(-1)
    if (!request) throw new Error("History batch fixture worker has no task")
    return request
  }
}

test("one batch history client preserves earlier node promises across reused candidate IDs and out-of-order deliveries within four workers", async (): Promise<void> => {
  const workers: ControlledHistoryBatchWorker[] = []
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, workerFactory: (): Worker => {
    if (workers.length === 4) throw new Error("HD batch history speculation exceeded four workers")
    const worker = new ControlledHistoryBatchWorker()
    workers.push(worker)
    return worker as unknown as Worker
  } })
  const job: ParallelHighDensityNodeBatchJob = { kind: "highDensityNodeBatch", contextId: 1,
    context: { connectivityNetMap: {}, connectivityIdToNetMap: {}, colorMap: {}, obstacles: [],
      viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1, layerCount: 2,
      allowBlindAndBuriedVias: false, preserveTerminalPcbPortIds: false,
      includeBoardObstacles: false, enableRegionalFallback: false, highDensityPolicy: "ordered" },
    nodes: [0, 1, 2].map((index) => ({ nodeWithPortPoints: createNetworkedNode({
      nodeId: `owner_${index}`, connectionName: `signal_${index}` }), nodePf: null })) }
  try {
    const batch = pool.run<ParallelHighDensityNodeBatchResult>(job)
    const owner = workers[0]!
    const taskId = owner.task().taskId
    const client = new MultiHeadHistoryWorkerClient(taskId, (request): void => owner.emit(request))
    owner.client = client
    const deliveries: Array<Promise<MultiHeadHistoryResult>> = []
    for (const entry of job.nodes) {
      const historyJob: MultiHeadHistoryJob = { kind: "multiHeadHistory", candidateId: 0,
        params: { nodeWithPortPoints: entry.nodeWithPortPoints }, connectivityNetMap: {}, connectivityIdToNetMap: {} }
      const grant = await client.dispatch([historyJob])
      const delivery = grant.get(0)
      if (!delivery) throw new Error("HD batch fixture expected idle history admission")
      deliveries.push(delivery)
    }
    expect(workers).toHaveLength(4)
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(pool.stats.historyRequestsGranted).toBe(3)
    expect(pool.stats.historyJobsStarted).toBe(3)
    for (const workerIndex of [3, 1, 2]) {
      const worker = workers[workerIndex]!
      const task = worker.task()
      if (task.job.kind !== "multiHeadHistory") throw new Error("Expected native history worker")
      const result: MultiHeadHistoryResult = { kind: "multiHeadHistory",
        initial: { iterations: 0, maxIterations: 1000, solved: false, failed: false, error: null, progress: 0 },
        steps: [], solvedRoutes: [{ connectionName: task.job.params.nodeWithPortPoints.portPoints[0]!.connectionName,
          traceThickness: 0.15, viaDiameter: 0.3, route: [], vias: [] }] }
      worker.emit({ taskId: task.taskId, ok: true, result })
      await Promise.resolve()
    }
    const delivered = await Promise.all(deliveries)
    expect(delivered.map((result) => result.solvedRoutes[0]!.connectionName)).toEqual(["signal_0", "signal_1", "signal_2"])
    const received = owner.messages.filter((message): message is MultiHeadHistoryDelivery =>
      "kind" in message && message.kind === "multiHeadHistoryDelivery")
    expect(received.map((message) => [message.requestId, message.candidateId])).toEqual([[3, 0], [1, 0], [2, 0]])
    owner.emit({ taskId, ok: true, result: { kind: "highDensityNodeBatch", results: job.nodes.map((entry) => ({
      nodeId: entry.nodeWithPortPoints.capacityMeshNodeId,
      result: { status: "solved", routes: [], nodeStats: {}, nodeIterations: 5, nodeMaximumIterations: 100e6 },
    })) } })
    expect((await batch).results).toHaveLength(3)
    expect(pool.stats.tasksStarted).toBe(4)
    expect(pool.stats.tasksCompleted).toBe(4)
  } finally { pool.dispose() }
})
