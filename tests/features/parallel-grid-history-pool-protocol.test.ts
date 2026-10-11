import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { executeGridHistoryJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/executeGridHistoryJob"
import type { GridHistoryDelivery, GridHistoryGrant, GridHistoryJob, GridHistoryResult } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelGridHistoryTypes"
import type { Pipeline9LocalWorkerRequest, Pipeline9LocalWorkerResponse, Pipeline9ParallelHighDensityNodeJob } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelWorkerTypes"
import { createNetworkedNode } from "tests/fixtures/pipeline9-networked-fixtures"

type PoolMessage = Pipeline9LocalWorkerRequest | GridHistoryGrant | GridHistoryDelivery

class ControlledGridWorker {
  onmessage: ((event: MessageEvent<Pipeline9LocalWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: PoolMessage[] = []
  terminated = false

  postMessage(message: PoolMessage): void {
    if (this.terminated) throw new Error("Grid control was sent after worker termination")
    this.messages.push(message)
  }

  emit(response: Pipeline9LocalWorkerResponse): void {
    if (!this.onmessage) throw new Error("Controlled grid worker has no message handler")
    this.onmessage(new MessageEvent("message", { data: response }))
  }

  terminate(): void {
    this.terminated = true
    this.onmessage = null
    this.onerror = null
  }
}

function ownerJob(index: number): Pipeline9ParallelHighDensityNodeJob {
  return { kind: "highDensityNode", contextId: 1, nodePf: null,
    nodeWithPortPoints: createNetworkedNode({ nodeId: `grid-owner${index}`, connectionName: `signal${index}` }),
    context: { connectivityNetMap: {}, connectivityIdToNetMap: {}, colorMap: {}, obstacles: [],
      viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15, effort: 1, layerCount: 2,
      allowBlindAndBuriedVias: false, preserveTerminalPcbPortIds: true, includeBoardObstacles: true,
      enableRegionalFallback: false } }
}

function gridJob(candidateId: number): GridHistoryJob {
  return { kind: "gridHistory", algorithm: "a01", candidateId, maxIterations: 100, ownerIterations: 0,
    params: { nodeWithPortPoints: ownerJob(candidateId).nodeWithPortPoints, cellSizeMm: 0.1, viaDiameter: 0.3 } }
}

function latestTask(worker: ControlledGridWorker): Pipeline9LocalWorkerRequest {
  const task = worker.messages.filter((message): message is Pipeline9LocalWorkerRequest => "job" in message).at(-1)
  if (!task) throw new Error("Controlled grid worker has no native task")
  return task
}

function latestGrant(worker: ControlledGridWorker): GridHistoryGrant {
  const grant = worker.messages.filter((message): message is GridHistoryGrant => "kind" in message && message.kind === "gridHistoryGrant").at(-1)
  if (!grant) throw new Error("Controlled grid owner has no admission grant")
  return grant
}

test("grid history protocol lends only idle cores, cancels unused work and rejects malformed native histories and requests", async (): Promise<void> => {
  const workers: ControlledGridWorker[] = []
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4, workerFactory: (): Worker => {
    if (workers.length === 4) throw new Error("Grid histories exceeded four workers")
    const worker = new ControlledGridWorker()
    workers.push(worker)
    return worker as unknown as Worker
  } })
  try {
    const owners = [0, 1, 2, 3].map((index) => pool.run(ownerJob(index)))
    const queued = pool.run({ kind: "warmup" })
    const owner = workers[0]!
    const taskId = latestTask(owner).taskId
    const jobs = [10, 11, 12].map(gridJob)
    owner.emit({ kind: "requestGridHistories", taskId, requestId: 1, jobs })
    expect(latestGrant(owner).admittedCandidateIds).toEqual([])
    workers[1]!.emit({ taskId: latestTask(workers[1]!).taskId, ok: true, result: "owner1" })
    expect(latestTask(workers[1]!).job.kind).toBe("warmup")
    owner.emit({ kind: "requestGridHistories", taskId, requestId: 2, jobs })
    expect(latestGrant(owner).admittedCandidateIds).toEqual([])
    workers[1]!.emit({ taskId: latestTask(workers[1]!).taskId, ok: true, result: "queued" })
    owner.emit({ kind: "requestGridHistories", taskId, requestId: 3, jobs })
    expect(latestGrant(owner).admittedCandidateIds).toEqual([10])
    const first = latestTask(workers[1]!)
    if (first.job.kind !== "gridHistory") throw new Error("Expected one admitted native grid history")
    const firstResult = executeGridHistoryJob(first.job)
    workers[1]!.emit({ taskId: first.taskId, ok: true, result: firstResult })
    await Promise.resolve()
    expect(owner.messages.filter((message) => "kind" in message && message.kind === "gridHistoryDelivery")).toHaveLength(1)
    workers[2]!.emit({ taskId: latestTask(workers[2]!).taskId, ok: true, result: "owner2" })
    workers[3]!.emit({ taskId: latestTask(workers[3]!).taskId, ok: true, result: "owner3" })
    owner.emit({ kind: "requestGridHistories", taskId, requestId: 4, jobs })
    expect(latestGrant(owner).admittedCandidateIds).toEqual([10, 11, 12])
    const admitted = workers.slice(1).map(latestTask)
    owner.emit({ taskId, ok: true, result: "owner0" })
    for (const [index, task] of admitted.entries()) {
      if (task.job.kind !== "gridHistory" || !task.job.cancellationBuffer) throw new Error("Expected cancellable native grid history")
      expect(Atomics.load(new Int32Array(task.job.cancellationBuffer), 0)).toBe(1)
      const stopped = executeGridHistoryJob(task.job)
      expect(stopped.cancelled).toBe(true)
      workers[index + 1]!.emit({ taskId: task.taskId, ok: true, result: stopped })
    }
    await Promise.resolve()
    expect(await Promise.all(owners)).toEqual(["owner0", "owner1", "owner2", "owner3"])
    expect(await queued).toBe("queued")
    expect(pool.stats.maxActiveWorkers).toBe(4)
    expect(pool.stats.gridHistoryRequestsDenied).toBe(2)
    expect(pool.stats.gridHistoryRequestsGranted).toBe(2)
    expect(pool.stats.gridHistoryJobsStarted).toBe(4)
    expect(pool.stats.gridHistoryCancellationSignals).toBe(3)
    expect(pool.stats.gridHistoryJobsStopped).toBe(3)
    expect(pool.stats.gridHistoryComputedIterations).toBe(firstResult.computedIterations)
  } finally { pool.dispose() }

  const validJob = gridJob(0)
  const validResult = executeGridHistoryJob(validJob)
  const malformedResults: Array<(result: GridHistoryResult) => void> = [
    (result): void => { Object.assign(result, { kind: "invalid" }) },
    (result): void => { result.algorithm = "a03" },
    (result): void => { result.computedIterations = NaN },
    (result): void => { result.initial.maxIterations++ },
    (result): void => { result.initial.solvedSegmentCount = -1 },
    (result): void => { result.checkpoints[0]!.progress = Infinity },
    (result): void => { result.checkpoints[0]!.solved = true; result.checkpoints[0]!.failed = true },
    (result): void => { result.checkpoints = [] },
    (result): void => { Object.assign(result, { output: null }) },
    (result): void => { Object.assign(result.checkpoints[0]!, { exception: null }) },
    (result): void => { Object.assign(result, { outputException: false }) },
  ]
  for (const mutate of malformedResults) {
    const controlled: ControlledGridWorker[] = []
    const rejectingPool = new Pipeline9LocalWorkerPool({ workerCount: 2, workerFactory: (): Worker => {
      const worker = new ControlledGridWorker(); controlled.push(worker); return worker as unknown as Worker
    } })
    const pending = rejectingPool.run(validJob)
    const peer = rejectingPool.run({ kind: "warmup" })
    const settled = Promise.allSettled([pending, peer])
    const malformed = structuredClone(validResult)
    mutate(malformed)
    controlled[0]!.emit({ taskId: latestTask(controlled[0]!).taskId, ok: true, result: malformed })
    expect((await settled).every((result) => result.status === "rejected")).toBe(true)
    expect(controlled.every((worker) => worker.terminated)).toBe(true)
    rejectingPool.dispose()
  }

  const invalidRequests: Array<{ jobs: GridHistoryJob[]; requestId: number }> = [
    { jobs: [validJob, validJob], requestId: 1 },
    { jobs: [0, 1, 2, 3].map(gridJob), requestId: 1 },
    { jobs: [], requestId: 1 },
    { jobs: [validJob], requestId: 0 },
    { jobs: [{ ...validJob, maxIterations: -1 }], requestId: 1 },
    { jobs: [{ ...validJob, ownerIterations: 1 }], requestId: 1 },
    { jobs: [Object.assign(structuredClone(validJob), { params: { ...validJob.params, initialPenaltyFn: (): number => 0 } })], requestId: 1 },
  ]
  for (const invalid of invalidRequests) {
    let worker: ControlledGridWorker | undefined
    const rejectingPool = new Pipeline9LocalWorkerPool({ workerCount: 1, workerFactory: (): Worker => {
      worker = new ControlledGridWorker(); return worker as unknown as Worker
    } })
    const pending = rejectingPool.run(ownerJob(0))
    const settled = Promise.allSettled([pending])
    if (!worker) throw new Error("Expected a controlled grid owner")
    worker.emit({ kind: "requestGridHistories", taskId: latestTask(worker).taskId, ...invalid })
    expect((await settled)[0]!.status).toBe("rejected")
    expect(worker.terminated).toBe(true)
    rejectingPool.dispose()
  }
  const brokenWorkers: ControlledGridWorker[] = []
  const brokenPool = new Pipeline9LocalWorkerPool({ workerCount: 2, workerFactory: (): Worker => {
    const worker = new ControlledGridWorker(); brokenWorkers.push(worker); return worker as unknown as Worker
  } })
  const broken = brokenPool.run(validJob)
  const peer = brokenPool.run({ kind: "warmup" })
  const settled = Promise.allSettled([broken, peer])
  brokenWorkers[0]!.emit({ taskId: latestTask(brokenWorkers[0]!).taskId, ok: false,
    error: "Controlled grid worker infrastructure failure" })
  expect((await settled).every((result) => result.status === "rejected")).toBe(true)
  expect(brokenWorkers.every((worker) => worker.terminated)).toBe(true)
  brokenPool.dispose()
})
