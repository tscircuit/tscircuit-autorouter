import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import type { FirstValidA13NodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityFrontierTypes"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse, Pipeline9ParallelHighDensityNodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

class ControlledContextWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly tasks: Pipeline9LocalWorkerRequest[] = []
  postMessage(message: Pipeline9LocalWorkerRequest): void { this.tasks.push(message) }
  terminate(): void { this.onmessage = null; this.onerror = null }
  complete(): void {
    const task = this.tasks.at(-1)
    if (!task || !this.onmessage) throw new Error("Context worker has no active task")
    const result = task.job.kind === "highDensityA13Node"
      ? { kind: "highDensityA13Node", status: "cancelled", work: { iterations: 0, maxIterations: 0, routingIterations: 0, sourceStats: {} } }
      : { status: "cancelled", nodeStats: {} }
    this.onmessage(new MessageEvent("message", { data: { taskId: task.taskId, ok: true, result } }))
  }
}

test("generic and A13 node jobs share each worker's board-context cache and reseed new boards", async (): Promise<void> => {
  const workers: ControlledContextWorker[] = []
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 1, workerFactory: (): Worker => {
    const worker = new ControlledContextWorker()
    workers.push(worker)
    return worker as unknown as Worker
  } })
  const context = { connectivityNetMap: {}, connectivityIdToNetMap: {}, colorMap: {}, obstacles: [],
    viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.1, effort: 1, layerCount: 2,
    allowBlindAndBuriedVias: false, preserveTerminalPcbPortIds: true,
    includeBoardObstacles: true, enableRegionalFallback: false }
  const nodeWithPortPoints = createNetworkedNode({ nodeId: "cache", connectionName: "signal" })
  try {
    for (const [kind, contextId, includesContext] of [
      ["highDensityNode", 1, true], ["highDensityA13Node", 1, false],
      ["highDensityA13Node", 2, true], ["highDensityNode", 2, false],
      ["highDensityNode", 3, true], ["highDensityA13Node", 3, false],
    ] as const) {
      const common = { contextId, context, nodeWithPortPoints, nodePf: null }
      const job: Pipeline9ParallelHighDensityNodeJob | FirstValidA13NodeJob = kind === "highDensityNode"
        ? { ...common, kind } : { ...common, kind, cancellationBuffer: new SharedArrayBuffer(4) }
      const promise = pool.run(job)
      expect(workers).toHaveLength(1)
      const worker = workers[0]!
      const task = worker.tasks.at(-1)!
      expect(task.job.kind).toBe(kind)
      expect("context" in task.job).toBe(includesContext)
      if ("context" in task.job) expect(task.job.context).toBe(context)
      worker.complete()
      expect(await promise).toMatchObject({ status: "cancelled" })
    }
    expect(pool.stats.maxActiveWorkers).toBe(1)
    expect(pool.stats.tasksCompleted).toBe(6)
  } finally { pool.dispose() }
})
