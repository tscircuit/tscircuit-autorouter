import type {
  Pipeline9LocalWorkerJob,
  Pipeline9LocalWorkerRequest,
  Pipeline9LocalWorkerResponse,
} from "./parallelWorkerTypes"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant, MultiHeadHistoryRequest, MultiHeadHistoryResult } from "./parallelMultiHeadHistoryTypes"

type WorkerWithLifecycle = Worker & { ref?: () => void; unref?: () => void }
type QueuedTask = {
  taskId: number
  job: Pipeline9LocalWorkerJob
  resolve: (result: unknown) => void
  reject: (error: Error) => void
}
type WorkerSlot = {
  worker: WorkerWithLifecycle
  task: QueuedTask | null
  contextId: number | null
}
export type Pipeline9LocalWorkerPoolOptions = {
  workerCount?: number
  workerUrl?: URL
  workerFactory?: (url: URL) => Worker
}

/** A reusable local CPU pool. Each worker receives board context only once. */
export class Pipeline9LocalWorkerPool {
  readonly workerCount: number
  readonly stats = { tasksStarted: 0, tasksCompleted: 0, maxActiveWorkers: 0,
    historyRequestsGranted: 0, historyRequestsDenied: 0, historyJobsStarted: 0 }
  private readonly workerUrl: URL
  private readonly workerFactory: (url: URL) => Worker
  private readonly workers: WorkerSlot[] = []
  private readonly queue: QueuedTask[] = []
  private nextTaskId = 0
  private nextContextId = 0
  private terminalError: Error | null = null

  constructor(options: Pipeline9LocalWorkerPoolOptions = {}) {
    this.workerCount = options.workerCount ?? 4
    if (!Number.isInteger(this.workerCount) || this.workerCount < 1 || this.workerCount > 4) {
      throw new Error("Pipeline9 workerCount must be an integer between 1 and 4")
    }
    this.workerUrl = options.workerUrl ?? new URL(
      import.meta.url.endsWith(".ts") ? "./pipeline9LocalWorker.ts" : "./pipeline9LocalWorker.js",
      import.meta.url,
    )
    this.workerFactory = options.workerFactory ?? ((url: URL): Worker => new Worker(url, { type: "module" }))
  }

  createContextId(): number {
    if (this.terminalError) throw this.terminalError
    this.nextContextId++
    return this.nextContextId
  }

  run<T>(job: Pipeline9LocalWorkerJob): Promise<T> {
    if (this.terminalError) return Promise.reject(this.terminalError)
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ taskId: ++this.nextTaskId, job,
        resolve: (result: unknown): void => resolve(result as T), reject })
      try { this.dispatch() }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  async warmup(): Promise<void> {
    await Promise.all(Array.from({ length: this.workerCount }, () => this.run({ kind: "warmup" })))
  }

  dispose(): void {
    this.fail(new Error("Pipeline9 local worker pool was disposed"))
  }

  private createWorker(): WorkerSlot {
    const worker = this.workerFactory(this.workerUrl) as WorkerWithLifecycle
    const slot: WorkerSlot = { worker, task: null, contextId: null }
    worker.onmessage = (event: MessageEvent<Pipeline9LocalWorkerResponse>): void => {
      const response = event.data
      const task = slot.task
      if ("kind" in response) {
        try { this.admitHistoryRequest(slot, response) }
        catch (error: unknown) { this.fail(error instanceof Error ? error : new Error(String(error))) }
        return
      }
      if (!task || response.taskId !== task.taskId) {
        this.fail(new Error(`Pipeline9 worker returned unexpected task ${response.taskId}`))
        return
      }
      slot.task = null
      this.stats.tasksCompleted++
      if (response.ok) task.resolve(response.result)
      else {
        const error = new Error(response.error)
        task.reject(error)
        this.fail(error)
        return
      }
      worker.unref?.()
      try { this.dispatch() }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    }
    worker.onerror = (event: ErrorEvent): void => {
      event.preventDefault()
      this.fail(new Error(`Pipeline9 local worker failed: ${event.message}`))
    }
    this.workers.push(slot)
    return slot
  }

  private admitHistoryRequest(owner: WorkerSlot, request: MultiHeadHistoryRequest): void {
    if (!owner.task || owner.task.taskId !== request.taskId || owner.task.job.kind !== "highDensityNode") {
      this.fail(new Error("Multi-head history request has no active high-density owner"))
      return
    }
    if (request.jobs.length > 2 || request.jobs.some((job) => job.kind !== "multiHeadHistory") ||
        new Set(request.jobs.map((job) => job.candidateId)).size !== request.jobs.length) {
      this.fail(new Error("Multi-head history request has invalid candidates"))
      return
    }
    // Never queue dependent work behind owners that may themselves be waiting.
    // Independent ordinary work has priority; only unused thread slots are lent.
    const capacity = this.queue.length === 0
      ? this.workerCount - this.workers.filter((slot) => slot.task !== null).length
      : 0
    const jobs = request.jobs.slice(0, capacity)
    const grant: MultiHeadHistoryGrant = { kind: "multiHeadHistoryGrant",
      taskId: request.taskId, requestId: request.requestId,
      admittedCandidateIds: jobs.map((job) => job.candidateId) }
    owner.worker.postMessage(grant)
    if (jobs.length === 0) this.stats.historyRequestsDenied++
    else this.stats.historyRequestsGranted++
    for (const job of jobs) {
      this.stats.historyJobsStarted++
      void this.run<MultiHeadHistoryResult>(job).then(
        (result): void => this.deliverHistory(owner, { kind: "multiHeadHistoryDelivery",
          taskId: request.taskId, requestId: request.requestId, candidateId: job.candidateId, ok: true, result }),
        (error: unknown): void => this.deliverHistory(owner, { kind: "multiHeadHistoryDelivery",
          taskId: request.taskId, requestId: request.requestId, candidateId: job.candidateId,
          ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
    }
  }

  private deliverHistory(owner: WorkerSlot, delivery: MultiHeadHistoryDelivery): void {
    if (this.terminalError || owner.task?.taskId !== delivery.taskId) return
    try {
      owner.worker.postMessage(delivery)
    } catch (error: unknown) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private dispatch(): void {
    if (this.terminalError) return
    while (this.queue.length > 0) {
      let slot = this.workers.find((candidate) => candidate.task === null)
      if (!slot && this.workers.length < this.workerCount) slot = this.createWorker()
      if (!slot) return
      const task = this.queue.shift()!
      slot.task = task
      let job: Pipeline9LocalWorkerRequest["job"] = task.job
      if (task.job.kind === "highDensityNode") {
        if (slot.contextId === task.job.contextId) {
          const { context: _context, ...nodeJob } = task.job
          job = nodeJob
        } else slot.contextId = task.job.contextId
      }
      slot.worker.ref?.()
      this.stats.tasksStarted++
      this.stats.maxActiveWorkers = Math.max(this.stats.maxActiveWorkers,
        this.workers.filter((candidate) => candidate.task !== null).length)
      slot.worker.postMessage({ taskId: task.taskId, job } satisfies Pipeline9LocalWorkerRequest)
    }
  }

  private fail(error: Error): void {
    if (this.terminalError) return
    this.terminalError = error
    for (const task of this.queue.splice(0)) task.reject(error)
    for (const slot of this.workers) {
      slot.task?.reject(error)
      slot.task = null
      slot.worker.terminate()
    }
  }
}
