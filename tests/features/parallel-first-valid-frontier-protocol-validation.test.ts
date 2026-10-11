import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse, Pipeline9ParallelHighDensityContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createFirstValidNode } from "tests/fixtures/first-valid-hd-fixtures"

class ProtocolWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly requests: Pipeline9LocalWorkerRequest[] = []
  terminated = false

  postMessage(request: Pipeline9LocalWorkerRequest): void {
    if (this.terminated) {
      throw new Error("Protocol worker was terminated")
    }
    this.requests.push(request)
  }

  emit(result: unknown): void {
    const request = this.requests.at(-1)
    if (!request || !this.onmessage) throw new Error("Protocol worker has no active request")
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

test("malformed competitive results fail every active and queued task before an unused result can be ignored", async (): Promise<void> => {
  const context: Pipeline9ParallelHighDensityContext = { connectivityNetMap: {}, connectivityIdToNetMap: {},
    colorMap: {}, obstacles: [], viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.1, effort: 1, layerCount: 2,
    allowBlindAndBuriedVias: false, preserveTerminalPcbPortIds: true, includeBoardObstacles: true,
    enableRegionalFallback: false, highDensityPolicy: "first-valid" }
  const cases = [
    { kind: "highDensityNode" as const, result: { status: "unknown", nodeStats: {} }, message: "Generic HD worker returned an invalid competitive result" },
    { kind: "highDensityNode" as const, result: { status: "cancelled", nodeStats: { work: NaN } }, message: "HD worker returned nonnumeric node statistic work" },
    { kind: "highDensityA13Node" as const, result: { kind: "wrong", status: "cancelled", work: {} }, message: "A13 node worker returned an invalid frontier result" },
    { kind: "highDensityA13Node" as const, result: { kind: "highDensityA13Node", status: "cancelled",
      work: { iterations: 0, maxIterations: 1, routingIterations: NaN, sourceStats: {} } }, message: "A13 node worker returned invalid source work" },
  ]
  for (const failure of cases) {
    const workers: ProtocolWorker[] = []
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 2, workerFactory: (): Worker => {
      const worker = new ProtocolWorker()
      workers.push(worker)
      return worker as unknown as Worker
    } })
    try {
      const common = { contextId: 1, context, nodeWithPortPoints: createFirstValidNode(), nodePf: null,
        cancellationBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT) }
      const malformed = pool.run({ ...common, kind: failure.kind }).then(
        (result) => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error }))
      const active = pool.run({ kind: "warmup" }).then(
        (result) => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error }))
      const queued = pool.run({ kind: "warmup" }).then(
        (result) => ({ ok: true as const, result }), (error: unknown) => ({ ok: false as const, error }))
      workers[0]!.emit(failure.result)
      const outcomes = await Promise.all([malformed, active, queued])
      expect(outcomes.every((outcome) => !outcome.ok)).toBe(true)
      const errors = outcomes.map((outcome) => {
        if (outcome.ok) throw new Error("Malformed response unexpectedly resolved")
        return outcome.error
      })
      expect(errors[0]).toMatchObject({ message: failure.message })
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
})
