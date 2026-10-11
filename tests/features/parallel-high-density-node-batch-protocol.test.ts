import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { Pipeline9ParallelHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9ParallelHighDensitySolver"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { ParallelHighDensityNodeBatchJob, ParallelHighDensityNodeBatchResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelHighDensityNodeBatching"
import type { Pipeline9LocalWorkerJob, Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse,
  Pipeline9ParallelHighDensityContext, Pipeline9ParallelHighDensityNodeResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

class ControlledBatchWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly tasks: Pipeline9LocalWorkerRequest[] = []
  terminated = false
  postMessage(message: Pipeline9LocalWorkerRequest): void { this.tasks.push(message) }
  terminate(): void { this.terminated = true; this.onmessage = null; this.onerror = null }
  respond(result: unknown, error?: string): void {
    const task = this.tasks.at(-1)
    if (!task || !this.onmessage) throw new Error("Controlled HD batch worker has no task")
    this.onmessage(new MessageEvent("message", { data: error
      ? { taskId: task.taskId, ok: false, error }
      : { taskId: task.taskId, ok: true, result } }))
  }
}

class DeferredExceptionPool extends Pipeline9LocalWorkerPool {
  constructor(private readonly outcomes: Map<string, Pipeline9ParallelHighDensityNodeResult>) { super() }
  override async run<T>(job: Pipeline9LocalWorkerJob): Promise<T> {
    if (job.kind !== "highDensityNodeBatch") throw new Error("Deferred exception fixture expected only batched work")
    const result: ParallelHighDensityNodeBatchResult = { kind: "highDensityNodeBatch", results: job.nodes.map((entry) => {
      const nodeId = entry.nodeWithPortPoints.capacityMeshNodeId
      const outcome = this.outcomes.get(nodeId)
      if (!outcome) throw new Error("Deferred exception fixture is missing a native node")
      return { nodeId, result: outcome }
    }) }
    return result as T
  }
}

test("HD batch protocol rejects malformed work, caches board context once and defers node exceptions in original commit order", async (): Promise<void> => {
  const context: Pipeline9ParallelHighDensityContext = { connectivityNetMap: {}, connectivityIdToNetMap: {},
    colorMap: {}, obstacles: [], viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15,
    effort: 1, layerCount: 2, allowBlindAndBuriedVias: false, preserveTerminalPcbPortIds: true,
    includeBoardObstacles: false, enableRegionalFallback: false, highDensityPolicy: "ordered" }
  const nodes = Array.from({ length: 8 }, (_, index) => createNetworkedNode({ nodeId: `batch_${index}`,
    connectionName: `signal_${index}`, xOffset: index * 6 }))
  const params = { ...context, nodePortPoints: nodes, fixedHdRoutes: [], connMap: new ConnectivityMap({}) }
  const outcomes = new Map<string, Pipeline9ParallelHighDensityNodeResult>()
  for (const node of nodes) {
    const solver = new Pipeline9HighDensitySolver({ ...params, nodePortPoints: [node] })
    solver.solve()
    expect(solver.solved).toBe(true)
    outcomes.set(node.capacityMeshNodeId, { status: "solved", routes: solver.routes, nodeStats: solver.stats,
      nodeIterations: solver.iterations, nodeMaximumIterations: solver.MAX_ITERATIONS })
  }
  const job: ParallelHighDensityNodeBatchJob = { kind: "highDensityNodeBatch", contextId: 1, context,
    nodes: nodes.slice(0, 2).map((nodeWithPortPoints) => ({ nodeWithPortPoints, nodePf: null })) }
  const valid: ParallelHighDensityNodeBatchResult = { kind: job.kind, results: job.nodes.map((entry) => ({
    nodeId: entry.nodeWithPortPoints.capacityMeshNodeId, result: outcomes.get(entry.nodeWithPortPoints.capacityMeshNodeId)!,
  })) }
  const first = valid.results[0]!
  const malformed: unknown[] = [
    { ...valid, kind: "wrong" }, { ...valid, results: [] }, { ...valid, results: [...valid.results].reverse() },
    { ...valid, results: [{ ...first, nodeId: "other" }, valid.results[1]] },
    ...[
      { ...first.result, nodeStats: { invalid: NaN } }, { ...first.result, nodeStats: [] },
      { ...first.result, nodeIterations: -1 }, { ...first.result, nodeMaximumIterations: NaN },
      { ...first.result, status: "cancelled" }, { ...first.result, status: "failed", error: null },
      { ...first.result, status: "solved", routes: null },
      { ...first.result, status: "exception", exception: { name: "Error", message: null } },
      { ...first.result, firstValidStats: {} },
    ].map((result) => ({ ...valid, results: [{ ...first, result }, valid.results[1]] })),
  ]
  for (const response of [...malformed, "worker-error"]) {
    const workers: ControlledBatchWorker[] = []
    const pool = new Pipeline9LocalWorkerPool({ workerCount: 2, workerFactory: (): Worker => {
      const worker = new ControlledBatchWorker()
      workers.push(worker)
      return worker as unknown as Worker
    } })
    try {
      const pending = Promise.allSettled([pool.run(job), pool.run({ kind: "warmup" }), pool.run({ kind: "warmup" })])
      workers[0]!.respond(response, response === "worker-error" ? "deliberate HD batch transport error" : undefined)
      const results = await pending
      const failures = results.map((result) => {
        if (result.status !== "rejected") throw new Error("Malformed HD batch resolved")
        return result.reason
      })
      expect(failures[0]).toBeInstanceOf(Error)
      expect(failures[1]).toBe(failures[0])
      expect(failures[2]).toBe(failures[0])
      expect(workers.every((worker) => worker.terminated)).toBe(true)
      expect(pool.stats.tasksCompleted).toBe(response === "worker-error" ? 1 : 0)
      await expect(pool.run({ kind: "warmup" })).rejects.toBe(failures[0])
    } finally { pool.dispose() }
  }
  const worker = new ControlledBatchWorker()
  const cachedPool = new Pipeline9LocalWorkerPool({ workerCount: 1, workerFactory: (): Worker => worker as unknown as Worker })
  try {
    for (const [kind, contextId, includesContext] of [
      ["highDensityNodeBatch", 1, true], ["highDensityNode", 1, false],
      ["highDensityNodeBatch", 1, false], ["highDensityNodeBatch", 2, true],
      ["highDensityNode", 2, false],
    ] as const) {
      const request = kind === "highDensityNodeBatch" ? { ...job, contextId }
        : { kind, contextId, context, nodeWithPortPoints: nodes[0]!, nodePf: null }
      const completed = cachedPool.run(request)
      expect("context" in worker.tasks.at(-1)!.job).toBe(includesContext)
      worker.respond(kind === "highDensityNodeBatch" ? valid : first.result)
      await completed
    }
    expect(cachedPool.stats.tasksCompleted).toBe(5)
  } finally { cachedPool.dispose() }
  const malformedPool = new Pipeline9LocalWorkerPool({ workerFactory: (): Worker => {
    throw new Error("Malformed batch must be rejected before worker creation")
  } })
  try {
    await expect(malformedPool.run({ ...job, nodes: [job.nodes[0]!, job.nodes[0]!] })).rejects.toThrow("duplicate")
    expect(malformedPool.stats.tasksStarted).toBe(0)
    await expect(malformedPool.run({ kind: "warmup" })).rejects.toThrow("duplicate")
  } finally { malformedPool.dispose() }
  const failure = { name: "NativeNodeError", message: "deliberate later node exception", stack: "native stack" }
  outcomes.set(nodes[5]!.capacityMeshNodeId, { status: "exception", exception: failure,
    nodeStats: {}, nodeIterations: 1, nodeMaximumIterations: 100e6 })
  const exceptionPool = new DeferredExceptionPool(outcomes)
  try {
    const solver = new Pipeline9ParallelHighDensitySolver({ ...params, workerPool: exceptionPool })
    let caught: unknown
    try {
      while (!solver.solved && !solver.failed) {
        solver.step()
        if (solver.pendingEffects?.length) await Promise.all(solver.pendingEffects.map((effect) => effect.promise))
      }
    } catch (error: unknown) { caught = error }
    expect(caught).toMatchObject(failure)
    expect(solver.stats.solvedNodeCount).toBe(2)
    const firstCommitted = outcomes.get(nodes[7]!.capacityMeshNodeId)
    const secondCommitted = outcomes.get(nodes[6]!.capacityMeshNodeId)
    if (firstCommitted?.status !== "solved" || secondCommitted?.status !== "solved") {
      throw new Error("Deferred exception fixture lost its successful earlier nodes")
    }
    expect(solver.routes).toEqual([...firstCommitted.routes, ...secondCommitted.routes])
    expect(solver.solved).toBe(false)
  } finally { exceptionPool.dispose() }
})
