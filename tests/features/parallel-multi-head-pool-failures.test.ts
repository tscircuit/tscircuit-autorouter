import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant, MultiHeadHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelMultiHeadHistoryTypes"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse, Pipeline9ParallelHighDensityNodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

type PoolMessage = Pipeline9LocalWorkerRequest | MultiHeadHistoryGrant | MultiHeadHistoryDelivery
type FailureKind = "dispose" | "history-response" | "invalid-history" | "grant-post" | "history-startup"

class FailureWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: PoolMessage[] = []
  grantError: Error | null = null
  terminated = false

  postMessage(message: PoolMessage): void {
    if ("kind" in message && message.kind === "multiHeadHistoryGrant" && this.grantError) {
      throw this.grantError
    }
    this.messages.push(message)
  }

  emit(response: Pipeline9LocalWorkerResponse): void {
    const handler = this.onmessage
    if (!handler) {
      throw new Error("Failure worker has no response handler")
    }
    handler(new MessageEvent("message", { data: response }))
  }

  terminate(): void {
    this.terminated = true
    this.onmessage = null
    this.onerror = null
    this.grantError = null
  }
}

function createOwnerJob(index: number): Pipeline9ParallelHighDensityNodeJob {
  return {
    kind: "highDensityNode", contextId: 1, nodePf: null,
    nodeWithPortPoints: createNetworkedNode({ nodeId: `failure-owner${index}`, connectionName: `signal${index}` }),
    context: { connectivityNetMap: {}, connectivityIdToNetMap: {}, colorMap: {}, obstacles: [], viaDiameter: 0.3, traceWidth: 0.15,
      obstacleMargin: 0.15, effort: 1, layerCount: 2, allowBlindAndBuriedVias: false,
      preserveTerminalPcbPortIds: true, includeBoardObstacles: true, enableRegionalFallback: false },
  }
}

function latestTask(worker: FailureWorker): Pipeline9LocalWorkerRequest {
  const tasks = worker.messages.filter((message): message is Pipeline9LocalWorkerRequest => "job" in message)
  const task = tasks.at(-1)
  if (!task) {
    throw new Error("Failure worker has no assigned task")
  }
  return task
}

test("history startup, grant, malformed responses, worker failures and disposal reject all owners and queued work", async (): Promise<void> => {
  const failures: FailureKind[] = ["dispose", "history-response", "invalid-history", "grant-post", "history-startup"]
  for (const failure of failures) {
    const workers: FailureWorker[] = []
    const expectedError = new Error(`deliberate ${failure} failure`)
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 4,
      workerFactory: (): Worker => {
        if (failure === "history-startup" && workers.length === 2) throw expectedError
        const worker = new FailureWorker()
        workers.push(worker)
        return worker as unknown as Worker
      },
    })
    const ownerOutcomes = [0, 1].map((index) => pool.run(createOwnerJob(index)).then(
      (result) => ({ status: "resolved", result }), (error: unknown) => ({ status: "rejected", error }),
    ))
    try {
      const owner = workers[0]!
      const taskId = latestTask(owner).taskId
      if (failure === "grant-post") owner.grantError = expectedError
      const jobs: MultiHeadHistoryJob[] = [0, 1].map((candidateId) => ({ kind: "multiHeadHistory", candidateId,
        params: { nodeWithPortPoints: createOwnerJob(candidateId).nodeWithPortPoints }, connectivityNetMap: {}, connectivityIdToNetMap: {} }))
      expect(() => owner.emit({ kind: "requestMultiHeadHistories", taskId, requestId: 1, jobs })).not.toThrow()
      const queuedOutcome = pool.run({ kind: "warmup" }).then(
        (result) => ({ status: "resolved", result }), (error: unknown) => ({ status: "rejected", error }),
      )
      if (failure === "dispose") pool.dispose()
      if (failure === "history-response") {
        workers[2]!.emit({ taskId: latestTask(workers[2]!).taskId, ok: false, error: expectedError.message })
      }
      if (failure === "invalid-history") {
        workers[2]!.emit({ taskId: latestTask(workers[2]!).taskId, ok: true, result: null })
      }
      const outcomes = await Promise.all([...ownerOutcomes, queuedOutcome])
      expect(outcomes.every((outcome) => outcome.status === "rejected")).toBe(true)
      const errors = outcomes.map((outcome) => (outcome as { status: "rejected"; error: unknown }).error)
      expect(errors[0]).toBeInstanceOf(Error)
      expect(errors[1]).toBe(errors[0])
      expect(errors[2]).toBe(errors[0])
      if (failure === "grant-post" || failure === "history-startup") expect(errors[0]).toBe(expectedError)
      else expect(errors[0]).toMatchObject({ message: failure === "dispose" ? "Pipeline9 local worker pool was disposed"
        : failure === "invalid-history" ? "Multi-head worker returned an invalid history result" : expectedError.message })
      await expect(pool.run({ kind: "warmup" })).rejects.toBe(errors[0])
      expect(() => pool.createContextId()).toThrow(errors[0] as Error)
      expect(workers.every((worker) => worker.terminated)).toBe(true)
      expect(workers.length).toBeLessThanOrEqual(4)
      const completedBeforeDispose = pool.stats.tasksCompleted
      pool.dispose()
      expect(pool.stats.tasksCompleted).toBe(completedBeforeDispose)
    } finally {
      pool.dispose()
      await Promise.all(ownerOutcomes)
    }
  }
})
