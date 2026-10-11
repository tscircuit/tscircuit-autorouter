import type {
  Pipeline9LocalWorkerJob,
  Pipeline9LocalWorkerRequest,
  Pipeline9LocalWorkerResponse,
} from "./parallelWorkerTypes"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant, MultiHeadHistoryRequest, MultiHeadHistoryResult } from "./parallelMultiHeadHistoryTypes"
import type { FirstValidA13CandidateDelivery, FirstValidA13CandidateGrant, FirstValidA13CandidateRequest, FirstValidA13CandidateResult } from "./firstValidA13CandidateTypes"
import { assertParallelNodeBatchResult } from "./parallelNodeJobBatching"
import { assertParallelGlobalDrcTrialResult } from "./executeParallelGlobalDrcTrial"
import { assertParallelHighDensityNodeBatchJob, assertParallelHighDensityNodeBatchResult } from "./parallelHighDensityNodeBatching"
import { Pipeline9SharedContextCodec, type Pipeline9SharedContextFamily, type Pipeline9SharedContextReference } from "./Pipeline9SharedContextCodec"
import type { GridHistoryDelivery, GridHistoryGrant, GridHistoryRequest, GridHistoryResult } from "./parallelGridHistoryTypes"
import { assertGridHistoryJob, assertGridHistoryResult } from "./executeGridHistoryJob"

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
  pathingGraphId: number | null
  simplificationContextId: number | null
  simplificationCompleted: Set<number>
  globalDrcContextId: number | null
  globalDrcSnapshotId: number | null
}
export type Pipeline9LocalWorkerPoolOptions = {
  workerCount?: number
  workerUrl?: URL
  workerFactory?: (url: URL) => Worker
  contextTransport?: "structured-clone" | "bun-shared"
}

/** A reusable local CPU pool. Each worker receives board context only once. */
export class Pipeline9LocalWorkerPool {
  readonly workerCount: number
  readonly stats = { tasksStarted: 0, tasksCompleted: 0, maxActiveWorkers: 0,
    historyRequestsGranted: 0, historyRequestsDenied: 0, historyJobsStarted: 0,
    historyCancellationSignals: 0, historyJobsStopped: 0, historyStepsCompleted: 0,
    a13RequestsGranted: 0, a13RequestsDenied: 0, a13CandidatesStarted: 0,
    a13CancellationSignals: 0, a13CandidatesStopped: 0, a13RoutingIterationsCompleted: 0,
    a13NodeJobsCompleted: 0, a13NodeJobsStopped: 0, a13NodeRoutingIterationsCompleted: 0,
    contextSerializationCalls: 0, contextSerializedBytes: 0, sharedContextMessages: 0,
    contextAliasNativeMessages: 0, contextShapeNativeMessages: 0,
    gridHistoryRequestsGranted: 0, gridHistoryRequestsDenied: 0, gridHistoryJobsStarted: 0,
    gridHistoryCancellationSignals: 0, gridHistoryJobsStopped: 0, gridHistoryComputedIterations: 0,
    gridHistoryPrefixIterationsRecomputed: 0, gridHistoryCheckpointsCompleted: 0,
    gridHistoryLogicalIterationsReplayed: 0, gridHistoryEquivalentLogicalIterationsReplayed: 0,
    gridHistoryEquivalentCandidatesAdmitted: 0 }
  readonly contextTransport: "structured-clone" | "bun-shared"
  private readonly workerUrl: URL
  private readonly workerFactory: (url: URL) => Worker
  private readonly workers: WorkerSlot[] = []
  private readonly queue: QueuedTask[] = []
  private nextTaskId = 0
  private nextContextId = 0
  private terminalError: Error | null = null
  private sharedContextCodec?: Pipeline9SharedContextCodec
  private contextTransportInitialization?: Promise<void>
  private readonly candidateCancellationByOwner = new Map<number, Map<Int32Array, "multiHeadHistory" | "firstValidA13Candidate" | "gridHistory">>()

  constructor(options: Pipeline9LocalWorkerPoolOptions = {}) {
    this.workerCount = options.workerCount ?? 4
    this.contextTransport = options.contextTransport ?? "structured-clone"
    if (this.contextTransport !== "structured-clone" && this.contextTransport !== "bun-shared") {
      throw new Error("Pipeline9 contextTransport must be structured-clone or bun-shared")
    }
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
    if (this.contextTransport === "bun-shared" && !this.sharedContextCodec) {
      return this.initializeContextTransport().then((): Promise<T> => this.run<T>(job))
    }
    return new Promise<T>((resolve, reject) => {
      if (job.kind === "highDensityNodeBatch") {
        try { assertParallelHighDensityNodeBatchJob(job, job.context) }
        catch (error: unknown) {
          const failure = error instanceof Error ? error : new Error(String(error))
          reject(failure)
          this.fail(failure)
          return
        }
      }
      if (job.kind === "gridHistory") {
        try { assertGridHistoryJob(job) }
        catch (error: unknown) {
          const failure = error instanceof Error ? error : new Error(String(error))
          reject(failure)
          this.fail(failure)
          return
        }
      }
      this.queue.push({ taskId: ++this.nextTaskId, job,
        resolve: (result: unknown): void => resolve(result as T), reject })
      try { this.dispatch() }
      catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }

  initializeContextTransport(): Promise<void> {
    if (this.terminalError) return Promise.reject(this.terminalError)
    if (this.contextTransport === "structured-clone") return Promise.resolve()
    if (!this.contextTransportInitialization) {
      this.contextTransportInitialization = Pipeline9SharedContextCodec.create(this.stats).then((codec): void => {
        if (this.terminalError) throw this.terminalError
        this.sharedContextCodec = codec
      }).catch((error: unknown): never => {
        const failure = error instanceof Error ? error : new Error(String(error))
        this.fail(failure)
        throw failure
      })
    }
    return this.contextTransportInitialization
  }

  async warmup(): Promise<void> {
    await Promise.all(Array.from({ length: this.workerCount }, () => this.run({ kind: "warmup" })))
  }

  /** Imports workers while the coordinator prepares topology on its own core. */
  start(): void {
    if (this.terminalError) throw this.terminalError
    try {
      while (this.workers.length < this.workerCount) this.createWorker().worker.unref?.()
    } catch (error: unknown) {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.fail(failure)
      throw failure
    }
  }

  dispose(): void {
    this.fail(new Error("Pipeline9 local worker pool was disposed"))
  }

  private createWorker(): WorkerSlot {
    const worker = this.workerFactory(this.workerUrl) as WorkerWithLifecycle
    const slot: WorkerSlot = { worker, task: null, contextId: null, pathingGraphId: null,
      simplificationContextId: null, simplificationCompleted: new Set(), globalDrcContextId: null,
      globalDrcSnapshotId: null }
    worker.onmessage = (event: MessageEvent<Pipeline9LocalWorkerResponse>): void => {
      const response = event.data
      const task = slot.task
      if ("kind" in response) {
        try {
          if (response.kind === "requestMultiHeadHistories") this.admitHistoryRequest(slot, response)
          else if (response.kind === "requestGridHistories") this.admitGridHistoryRequest(slot, response)
          else if (response.kind === "requestFirstValidA13Candidate") this.admitA13Request(slot, response)
          else if (response.kind === "cancelMultiHeadHistories" || response.kind === "cancelFirstValidA13Candidate" || response.kind === "cancelGridHistories") {
            if (!task || task.taskId !== response.taskId ||
                (task.job.kind !== "highDensityNode" && task.job.kind !== "highDensityNodeBatch") ||
                (task.job.kind === "highDensityNodeBatch" && response.kind === "cancelFirstValidA13Candidate")) {
              throw new Error("Multi-head cancellation has no active high-density owner")
            }
            this.cancelOwnerCandidates(response.taskId)
          }
          else throw new Error("Unknown Pipeline9 worker control message")
        }
        catch (error: unknown) { this.fail(error instanceof Error ? error : new Error(String(error))) }
        return
      }
      if (!task || response.taskId !== task.taskId) {
        this.fail(new Error(`Pipeline9 worker returned unexpected task ${response.taskId}`))
        return
      }
      if (response.gridHistoryReplayWork !== undefined) {
        const work = response.gridHistoryReplayWork
        if ((task.job.kind !== "highDensityNode" && task.job.kind !== "highDensityNodeBatch") ||
          !work || !Number.isSafeInteger(work.logicalIterationsReplayed) || work.logicalIterationsReplayed < 0 ||
          !Number.isSafeInteger(work.equivalentLogicalIterationsReplayed) || work.equivalentLogicalIterationsReplayed < 0 ||
          work.equivalentLogicalIterationsReplayed > work.logicalIterationsReplayed ||
          !Number.isSafeInteger(work.equivalentCandidatesAdmitted) || work.equivalentCandidatesAdmitted < 0) {
          this.fail(new Error("Malformed grid history replay work"))
          return
        }
        this.stats.gridHistoryLogicalIterationsReplayed += work.logicalIterationsReplayed
        this.stats.gridHistoryEquivalentLogicalIterationsReplayed += work.equivalentLogicalIterationsReplayed
        this.stats.gridHistoryEquivalentCandidatesAdmitted += work.equivalentCandidatesAdmitted
      }
      if (response.ok && task.job.kind === "multiHeadHistory") {
        try { this.recordHistoryWork(response.result) }
        catch (error: unknown) {
          this.fail(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
      if (response.ok && task.job.kind === "gridHistory") {
        try {
          const history = response.result as GridHistoryResult
          assertGridHistoryResult(task.job, history)
          this.stats.gridHistoryComputedIterations += history.computedIterations
          this.stats.gridHistoryPrefixIterationsRecomputed += Math.min(task.job.ownerIterations, history.computedIterations)
          this.stats.gridHistoryCheckpointsCompleted += history.checkpoints.length
          if (history.cancelled) this.stats.gridHistoryJobsStopped++
        } catch (error: unknown) {
          this.fail(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
      if (response.ok && task.job.kind === "firstValidA13Candidate") {
        try { this.recordA13Work(response.result) }
        catch (error: unknown) {
          this.fail(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
      if (response.ok && (task.job.kind === "highDensityA13Node" ||
          (task.job.kind === "highDensityNode" && task.job.cancellationBuffer))) {
        try {
          if (task.job.kind === "highDensityA13Node") this.validateA13NodeResult(response.result)
          else this.validateCompetitiveGenericResult(response.result)
        } catch (error: unknown) {
          this.fail(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
      if (response.ok && (task.job.kind === "forceImproveNodeBatch" || task.job.kind === "repairNodeBatch")) {
        try { assertParallelNodeBatchResult(task.job, response.result) }
        catch (error: unknown) {
          this.fail(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
      if (response.ok && task.job.kind === "globalDrcForceTrial") {
        try { assertParallelGlobalDrcTrialResult(task.job, response.result) }
        catch (error: unknown) {
          this.fail(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
      if (response.ok && task.job.kind === "highDensityNodeBatch") {
        try { assertParallelHighDensityNodeBatchResult(task.job, response.result) }
        catch (error: unknown) {
          this.fail(error instanceof Error ? error : new Error(String(error)))
          return
        }
      }
      if (task.job.kind === "highDensityNode" || task.job.kind === "highDensityNodeBatch") this.cancelOwnerCandidates(task.taskId)
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
    if (!owner.task || owner.task.taskId !== request.taskId ||
        (owner.task.job.kind !== "highDensityNode" && owner.task.job.kind !== "highDensityNodeBatch")) {
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
      const cancellation = this.registerCandidateCancellation(request.taskId, "multiHeadHistory")
      this.stats.historyJobsStarted++
      void this.run<MultiHeadHistoryResult>({ ...job, cancellationBuffer: cancellation.buffer as SharedArrayBuffer }).then(
        (result): void => {
          this.removeCandidateCancellation(request.taskId, cancellation)
          this.deliverHistory(owner, { kind: "multiHeadHistoryDelivery",
            taskId: request.taskId, requestId: request.requestId, candidateId: job.candidateId, ok: true, result })
        },
        (error: unknown): void => {
          this.removeCandidateCancellation(request.taskId, cancellation)
          this.deliverHistory(owner, { kind: "multiHeadHistoryDelivery",
            taskId: request.taskId, requestId: request.requestId, candidateId: job.candidateId,
            ok: false, error: error instanceof Error ? error.message : String(error) })
        },
      )
    }
  }

  private admitA13Request(owner: WorkerSlot, request: FirstValidA13CandidateRequest): void {
    if (!owner.task || owner.task.taskId !== request.taskId || owner.task.job.kind !== "highDensityNode" ||
        owner.task.job.context.highDensityPolicy !== "first-valid" || request.job.kind !== "firstValidA13Candidate") {
      throw new Error("First-valid A13 request has no eligible high-density owner")
    }
    const admitted = this.queue.length === 0 &&
      this.workers.filter((slot) => slot.task !== null).length < this.workerCount
    owner.worker.postMessage({ kind: "firstValidA13CandidateGrant", taskId: request.taskId,
      requestId: request.requestId, admitted } satisfies FirstValidA13CandidateGrant)
    if (!admitted) {
      this.stats.a13RequestsDenied++
      return
    }
    this.stats.a13RequestsGranted++
    this.stats.a13CandidatesStarted++
    const cancellation = this.registerCandidateCancellation(request.taskId, "firstValidA13Candidate")
    void this.run<FirstValidA13CandidateResult>({ ...request.job,
      cancellationBuffer: cancellation.buffer as SharedArrayBuffer }).then(
      (result): void => {
        this.removeCandidateCancellation(request.taskId, cancellation)
        this.deliverA13(owner, { kind: "firstValidA13CandidateDelivery", taskId: request.taskId,
          requestId: request.requestId, ok: true, result })
      },
      (error: unknown): void => {
        this.removeCandidateCancellation(request.taskId, cancellation)
        this.deliverA13(owner, { kind: "firstValidA13CandidateDelivery", taskId: request.taskId,
          requestId: request.requestId, ok: false, error: error instanceof Error ? error.message : String(error) })
      },
    )
  }

  private registerCandidateCancellation(ownerTaskId: number, kind: "multiHeadHistory" | "firstValidA13Candidate" | "gridHistory"): Int32Array {
    const cancellation = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
    let cancellations = this.candidateCancellationByOwner.get(ownerTaskId)
    if (!cancellations) {
      cancellations = new Map<Int32Array, "multiHeadHistory" | "firstValidA13Candidate" | "gridHistory">()
      this.candidateCancellationByOwner.set(ownerTaskId, cancellations)
    }
    cancellations.set(cancellation, kind)
    return cancellation
  }

  private recordA13Work(result: unknown): void {
    if (!result || typeof result !== "object" || !("kind" in result) || result.kind !== "firstValidA13Candidate" ||
        !("status" in result) || !["solved", "failed", "cancelled", "exception"].includes(String(result.status)) ||
        !("routingIterations" in result) || typeof result.routingIterations !== "number" ||
        !Number.isFinite(result.routingIterations) || result.routingIterations < 0) {
      throw new Error("A13 worker returned an invalid candidate result")
    }
    this.stats.a13RoutingIterationsCompleted += result.routingIterations
    if (result.status === "cancelled") this.stats.a13CandidatesStopped++
  }

  private validateCompetitiveGenericResult(result: unknown): void {
    if (!result || typeof result !== "object" || !("status" in result) || typeof result.status !== "string" ||
        !["solved", "failed", "cancelled", "exception"].includes(result.status) || !("nodeStats" in result)) {
      throw new Error("Generic HD worker returned an invalid competitive result")
    }
    this.validateNumericNodeStats(result.nodeStats)
    if (result.status === "solved" && (!("routes" in result) || !Array.isArray(result.routes))) {
      throw new Error("Generic HD worker returned a solved result without routes")
    }
    if (result.status === "failed" && (!("error" in result) || typeof result.error !== "string")) {
      throw new Error("Generic HD worker returned a failed result without an error")
    }
    if (result.status === "exception") {
      if (!("exception" in result)) throw new Error("Generic HD worker returned an exception result without its exception")
      this.validateWorkerException(result.exception)
    }
  }

  private validateA13NodeResult(result: unknown): void {
    if (!result || typeof result !== "object" || !("kind" in result) || result.kind !== "highDensityA13Node" ||
        !("status" in result) || typeof result.status !== "string" ||
        !["solved", "failed", "cancelled", "rejected", "exception"].includes(result.status) ||
        !("work" in result) || !result.work || typeof result.work !== "object") {
      throw new Error("A13 node worker returned an invalid frontier result")
    }
    const work = result.work
    if (!("iterations" in work) || typeof work.iterations !== "number" || !Number.isFinite(work.iterations) || work.iterations < 0 ||
        !("maxIterations" in work) || typeof work.maxIterations !== "number" || !Number.isFinite(work.maxIterations) || work.maxIterations < 0 ||
        !("routingIterations" in work) || typeof work.routingIterations !== "number" || !Number.isFinite(work.routingIterations) || work.routingIterations < 0 ||
        !("sourceStats" in work) || !work.sourceStats || typeof work.sourceStats !== "object") {
      throw new Error("A13 node worker returned invalid source work")
    }
    if (result.status === "solved") {
      if (!("routes" in result) || !Array.isArray(result.routes) || !("nodeStats" in result)) {
        throw new Error("A13 node worker returned an incomplete solved result")
      }
      this.validateNumericNodeStats(result.nodeStats)
    } else if (result.status === "failed" && (!("error" in result) || typeof result.error !== "string")) {
      throw new Error("A13 node worker returned a failed result without an error")
    } else if (result.status === "rejected" && (!("reason" in result) || typeof result.reason !== "string")) {
      throw new Error("A13 node worker returned a rejected result without a reason")
    } else if (result.status === "exception") {
      if (!("exception" in result)) throw new Error("A13 node worker returned an exception result without its exception")
      this.validateWorkerException(result.exception)
    }
    this.stats.a13NodeJobsCompleted++
    this.stats.a13NodeRoutingIterationsCompleted += work.routingIterations
    if (result.status === "cancelled") this.stats.a13NodeJobsStopped++
  }

  private validateNumericNodeStats(stats: unknown): void {
    if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
      throw new Error("HD worker returned invalid node statistics")
    }
    for (const [key, value] of Object.entries(stats)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`HD worker returned nonnumeric node statistic ${key}`)
      }
    }
  }

  private validateWorkerException(exception: unknown): void {
    if (!exception || typeof exception !== "object" || !("name" in exception) || typeof exception.name !== "string" ||
        !("message" in exception) || typeof exception.message !== "string" ||
        ("stack" in exception && exception.stack !== undefined && typeof exception.stack !== "string")) {
      throw new Error("HD worker returned invalid exception metadata")
    }
  }

  private recordHistoryWork(result: unknown): void {
    if (!result || typeof result !== "object" || !("kind" in result) ||
        result.kind !== "multiHeadHistory" || !("steps" in result) || !Array.isArray(result.steps)) {
      throw new Error("Multi-head worker returned an invalid history result")
    }
    this.stats.historyStepsCompleted += result.steps.length
    if ("cancelled" in result && result.cancelled === true) this.stats.historyJobsStopped++
  }

  private removeCandidateCancellation(ownerTaskId: number, cancellation: Int32Array): void {
    const cancellations = this.candidateCancellationByOwner.get(ownerTaskId)
    if (!cancellations) return
    cancellations.delete(cancellation)
    if (cancellations.size === 0) {
      this.candidateCancellationByOwner.delete(ownerTaskId)
    }
  }

  private cancelOwnerCandidates(ownerTaskId: number): void {
    const cancellations = this.candidateCancellationByOwner.get(ownerTaskId)
    if (!cancellations) return
    for (const [cancellation, kind] of cancellations) {
      if (Atomics.exchange(cancellation, 0, 1) !== 0) continue
      if (kind === "multiHeadHistory") this.stats.historyCancellationSignals++
      else if (kind === "gridHistory") this.stats.gridHistoryCancellationSignals++
      else this.stats.a13CancellationSignals++
    }
    this.candidateCancellationByOwner.delete(ownerTaskId)
  }

  private deliverHistory(owner: WorkerSlot, delivery: MultiHeadHistoryDelivery): void {
    if (this.terminalError || owner.task?.taskId !== delivery.taskId) return
    try {
      owner.worker.postMessage(delivery)
    } catch (error: unknown) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private deliverA13(owner: WorkerSlot, delivery: FirstValidA13CandidateDelivery): void {
    if (this.terminalError || owner.task?.taskId !== delivery.taskId) return
    try {
      owner.worker.postMessage(delivery)
    } catch (error: unknown) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private admitGridHistoryRequest(owner: WorkerSlot, request: GridHistoryRequest): void {
    if (!owner.task || owner.task.taskId !== request.taskId ||
      (owner.task.job.kind !== "highDensityNode" && owner.task.job.kind !== "highDensityNodeBatch") ||
      (owner.task.job.context.highDensityPolicy ?? "ordered") !== "ordered") {
      throw new Error("Grid history request has no active ordered high-density owner")
    }
    if (!Number.isSafeInteger(request.requestId) || request.requestId < 1 || !Array.isArray(request.jobs) ||
      request.jobs.length < 1 || request.jobs.length > 3 ||
      new Set(request.jobs.map((job) => job.candidateId)).size !== request.jobs.length) {
      throw new Error("Grid history request has invalid candidates")
    }
    for (const job of request.jobs) assertGridHistoryJob(job)
    // Ordinary node/stage work retains priority and no owner can queue its
    // dependent history behind four occupied workers. Only current idle slots
    // are lent, so denial leaves the same native candidate running locally.
    const capacity = this.queue.length === 0
      ? this.workerCount - this.workers.filter((slot) => slot.task !== null).length : 0
    const jobs = request.jobs.slice(0, capacity)
    owner.worker.postMessage({ kind: "gridHistoryGrant", taskId: request.taskId,
      requestId: request.requestId, admittedCandidateIds: jobs.map((job) => job.candidateId) } satisfies GridHistoryGrant)
    if (jobs.length === 0) this.stats.gridHistoryRequestsDenied++
    else this.stats.gridHistoryRequestsGranted++
    for (const job of jobs) {
      const cancellation = this.registerCandidateCancellation(request.taskId, "gridHistory")
      this.stats.gridHistoryJobsStarted++
      void this.run<GridHistoryResult>({ ...job, cancellationBuffer: cancellation.buffer as SharedArrayBuffer }).then(
        (result): void => {
          this.removeCandidateCancellation(request.taskId, cancellation)
          this.deliverGridHistory(owner, { kind: "gridHistoryDelivery", taskId: request.taskId,
            requestId: request.requestId, candidateId: job.candidateId, ok: true, result })
        },
        (error: unknown): void => {
          this.removeCandidateCancellation(request.taskId, cancellation)
          this.deliverGridHistory(owner, { kind: "gridHistoryDelivery", taskId: request.taskId,
            requestId: request.requestId, candidateId: job.candidateId, ok: false,
            error: error instanceof Error ? error.message : String(error) })
        },
      )
    }
  }

  private deliverGridHistory(owner: WorkerSlot, delivery: GridHistoryDelivery): void {
    if (this.terminalError || owner.task?.taskId !== delivery.taskId) return
    try { owner.worker.postMessage(delivery) }
    catch (error: unknown) {
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
      if (task.job.kind === "highDensityNode" || task.job.kind === "highDensityA13Node" || task.job.kind === "highDensityNodeBatch") {
        if (slot.contextId === task.job.contextId) {
          const { context: _context, ...nodeJob } = task.job
          job = nodeJob
        } else slot.contextId = task.job.contextId
      }
      if (task.job.kind === "pathingNegotiatedRoute") {
        if (slot.pathingGraphId === task.job.graphId) {
          const { graph: _graph, ...routeJob } = task.job
          job = routeJob
        } else {
          if (!task.job.graph) throw new Error(`Negotiated pathing worker needs graph ${task.job.graphId}`)
          slot.pathingGraphId = task.job.graphId
        }
      }
      if (task.job.kind === "simplifyPathWave") {
        const pathJob = task.job
        if (slot.simplificationContextId !== pathJob.contextId) {
          if (!pathJob.context) throw new Error(`Path worker needs context ${pathJob.contextId}`)
          slot.simplificationContextId = pathJob.contextId
          slot.simplificationCompleted.clear()
        } else {
          const { context: _context, ...withoutContext } = pathJob
          job = withoutContext
        }
        const updates = pathJob.updates.filter((update) => !slot.simplificationCompleted.has(update.index))
        job = { ...job, updates } as typeof pathJob
        for (const update of updates) slot.simplificationCompleted.add(update.index)
        for (const index of pathJob.indexes) slot.simplificationCompleted.add(index)
      }
      if (task.job.kind === "globalDrcForceTrial") {
        if (slot.globalDrcContextId === task.job.contextId) {
          const { context: _context, ...trialJob } = task.job
          job = trialJob
        } else {
          if (!task.job.context) throw new Error(`Global DRC worker needs context ${task.job.contextId}`)
          slot.globalDrcContextId = task.job.contextId
        }
        if (slot.globalDrcSnapshotId === task.job.snapshotId) {
          const { snapshot: _snapshot, ...trialJob } = job as typeof task.job
          job = trialJob
        } else {
          if (!task.job.snapshot) throw new Error(`Global DRC worker needs snapshot ${task.job.snapshotId}`)
          slot.globalDrcSnapshotId = task.job.snapshotId
        }
      }
      let sharedContext: Pipeline9SharedContextReference | undefined
      if (this.sharedContextCodec && "context" in job && job.context) {
        const family: Pipeline9SharedContextFamily | undefined =
          job.kind === "highDensityNode" || job.kind === "highDensityA13Node" || job.kind === "highDensityNodeBatch"
            ? "high-density" : job.kind === "simplifyPathWave" ? "simplification"
            : job.kind === "globalDrcForceTrial" ? "global-drc" : undefined
        if (family && "contextId" in job) {
          const { context, ...mutableJob } = job
          sharedContext = this.sharedContextCodec.getReference(family, job.contextId, context, mutableJob)
          if (sharedContext) job = mutableJob
        }
      }
      slot.worker.ref?.()
      this.stats.tasksStarted++
      this.stats.maxActiveWorkers = Math.max(this.stats.maxActiveWorkers,
        this.workers.filter((candidate) => candidate.task !== null).length)
      slot.worker.postMessage({ taskId: task.taskId, job,
        ...(sharedContext ? { sharedContext } : {}) } satisfies Pipeline9LocalWorkerRequest)
    }
  }

  private fail(error: Error): void {
    if (this.terminalError) return
    this.terminalError = error
    for (const ownerTaskId of this.candidateCancellationByOwner.keys()) this.cancelOwnerCandidates(ownerTaskId)
    for (const task of this.queue.splice(0)) task.reject(error)
    for (const slot of this.workers) {
      slot.task?.reject(error)
      slot.task = null
      slot.worker.terminate()
    }
  }
}
