import { Worker } from "node:worker_threads"
import type {
  HybridWorkerBoardContext,
  HybridWorkerCopperUpdate,
  HybridWorkerResponse,
  RegionJob,
} from "./worker-protocol"

export type HybridWorkerPoolJobResult =
  | {
      readonly status: "completed"
      readonly response: Extract<HybridWorkerResponse, { type: "result" }>
      readonly queueWaitMs: number
    }
  | {
      readonly status: "failed"
      readonly response: Extract<HybridWorkerResponse, { type: "job_failed" }>
      readonly queueWaitMs: number
    }
  | {
      readonly status: "cancelled"
      readonly jobId: string
      readonly workerId?: string
      readonly queueWaitMs: number
    }

type PendingJob = {
  readonly job: RegionJob
  readonly enqueuedAt: number
  readonly resolve: (result: HybridWorkerPoolJobResult) => void
}

type Deferred = {
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

type WorkerSlot = {
  readonly slotIndex: number
  workerId: string
  worker: Worker
  initialized: boolean
  activeJob?: PendingJob
  initialization?: Deferred
  copperUpdate?: Deferred
  restarting: boolean
}

export class HybridRoutingWorkerPool {
  private readonly workerEntryPath: string
  private readonly runtimeTarget: "native" | "wasm"
  private readonly runtimeModulePath: string
  private readonly maximumWorkerCount: number
  private readonly maximumQueueLength: number
  private readonly slots: WorkerSlot[] = []
  private readonly queue: PendingJob[] = []
  private context?: HybridWorkerBoardContext
  private closing = false

  constructor({
    workerEntryPath,
    runtimeTarget,
    runtimeModulePath,
    maximumWorkerCount,
    maximumQueueLength,
  }: {
    workerEntryPath: string
    runtimeTarget: "native" | "wasm"
    runtimeModulePath: string
    maximumWorkerCount: number
    maximumQueueLength: number
  }) {
    validatePositiveInteger({ value: maximumWorkerCount, name: "maximumWorkerCount" })
    validatePositiveInteger({ value: maximumQueueLength, name: "maximumQueueLength" })
    if (!workerEntryPath || !runtimeModulePath) {
      throw new Error("workerEntryPath and runtimeModulePath must not be empty")
    }
    this.workerEntryPath = workerEntryPath
    this.runtimeTarget = runtimeTarget
    this.runtimeModulePath = runtimeModulePath
    this.maximumWorkerCount = maximumWorkerCount
    this.maximumQueueLength = maximumQueueLength
  }

  async initialize(context: HybridWorkerBoardContext): Promise<void> {
    if (this.context || this.slots.length > 0) {
      throw new Error("hybrid worker pool can only be initialized once")
    }
    if (this.closing) throw new Error("cannot initialize a closing worker pool")
    this.context = context
    const initializations: Promise<void>[] = []
    for (let slotIndex = 0; slotIndex < this.maximumWorkerCount; slotIndex++) {
      const slot = this.createSlot(slotIndex)
      this.slots.push(slot)
      initializations.push(this.initializeSlot(slot))
    }
    await Promise.all(initializations)
  }

  submit(job: RegionJob): Promise<HybridWorkerPoolJobResult> {
    if (!this.context || this.slots.some((slot) => !slot.initialized)) {
      throw new Error("hybrid worker pool must be initialized before submitting jobs")
    }
    if (this.closing) throw new Error("cannot submit to a closing worker pool")
    if (this.findPendingJob(job.jobId)) {
      throw new Error(`job ${job.jobId} is already pending or active`)
    }
    if (this.queue.length >= this.maximumQueueLength) {
      throw new Error(
        `hybrid worker queue reached bound ${this.maximumQueueLength}`,
      )
    }
    return new Promise((resolve) => {
      this.queue.push({ job, enqueuedAt: performance.now(), resolve })
      this.dispatch()
    })
  }

  async cancel(jobId: string): Promise<boolean> {
    const queuedIndex = this.queue.findIndex(
      (pending) => pending.job.jobId === jobId,
    )
    if (queuedIndex >= 0) {
      const [pending] = this.queue.splice(queuedIndex, 1)
      pending!.resolve({
        status: "cancelled",
        jobId,
        queueWaitMs: performance.now() - pending!.enqueuedAt,
      })
      return true
    }
    const slot = this.slots.find(
      (candidate) => candidate.activeJob?.job.jobId === jobId,
    )
    if (!slot?.activeJob) return false
    const active = slot.activeJob
    slot.activeJob = undefined
    active.resolve({
      status: "cancelled",
      jobId,
      workerId: slot.workerId,
      queueWaitMs: performance.now() - active.enqueuedAt,
    })
    await this.restartSlot(slot)
    this.dispatch()
    return true
  }

  async applyCopperUpdate(update: HybridWorkerCopperUpdate): Promise<void> {
    if (!this.context) throw new Error("worker pool is not initialized")
    if (this.queue.length > 0 || this.slots.some((slot) => slot.activeJob)) {
      throw new Error("copper updates require an idle worker pool")
    }
    if (
      update.baseCopperVersion !== this.context.copperVersion ||
      update.nextCopperVersion !== this.context.copperVersion + 1
    ) {
      throw new Error(
        `pool copper update must advance version ${this.context.copperVersion} by one`,
      )
    }
    await Promise.all(
      this.slots.map(
        (slot) =>
          new Promise<void>((resolve, reject) => {
            slot.copperUpdate = { resolve, reject }
            slot.worker.postMessage({
              type: "apply_copper_update",
              update,
            })
          }),
      ),
    )
    this.context = Object.freeze({
      ...this.context,
      copperVersion: update.nextCopperVersion,
      geometry: Object.freeze([
        ...this.context.geometry.filter(
          (item) => !update.removedGeometryIds.includes(item.geometry.geometryId),
        ),
        ...update.addedGeometry,
      ]),
    })
  }

  async close(): Promise<void> {
    if (this.closing) return
    this.closing = true
    for (const pending of this.queue.splice(0)) {
      pending.resolve({
        status: "cancelled",
        jobId: pending.job.jobId,
        queueWaitMs: performance.now() - pending.enqueuedAt,
      })
    }
    await Promise.all(
      this.slots.map(async (slot) => {
        if (slot.activeJob) {
          slot.activeJob.resolve({
            status: "cancelled",
            jobId: slot.activeJob.job.jobId,
            workerId: slot.workerId,
            queueWaitMs: performance.now() - slot.activeJob.enqueuedAt,
          })
          slot.activeJob = undefined
        }
        slot.worker.removeAllListeners()
        await slot.worker.terminate()
      }),
    )
  }

  private createSlot(slotIndex: number): WorkerSlot {
    const workerId = `hybrid-worker-${slotIndex}`
    const worker = new Worker(this.workerEntryPath, {
      workerData: {
        workerId,
        target: this.runtimeTarget,
        runtimeModulePath: this.runtimeModulePath,
      },
    })
    const slot: WorkerSlot = {
      slotIndex,
      workerId,
      worker,
      initialized: false,
      restarting: false,
    }
    this.attachSlotListeners(slot)
    return slot
  }

  private initializeSlot(slot: WorkerSlot): Promise<void> {
    const context = this.context
    if (!context) throw new Error("worker context is unavailable")
    return new Promise<void>((resolve, reject) => {
      slot.initialization = { resolve, reject }
      slot.worker.postMessage({ type: "initialize", context })
    })
  }

  private attachSlotListeners(slot: WorkerSlot): void {
    slot.worker.on("message", (message: HybridWorkerResponse) => {
      this.handleWorkerMessage({ slot, message })
    })
    slot.worker.on("error", (error) => {
      this.handleWorkerFailure({ slot, error })
    })
    slot.worker.on("exit", (code) => {
      if (code !== 0 && !this.closing && !slot.restarting) {
        this.handleWorkerFailure({
          slot,
          error: new Error(`${slot.workerId} exited with code ${code}`),
        })
      }
    })
  }

  private handleWorkerMessage({
    slot,
    message,
  }: {
    slot: WorkerSlot
    message: HybridWorkerResponse
  }): void {
    if (message.type === "initialized") {
      slot.initialized = true
      slot.initialization?.resolve()
      slot.initialization = undefined
      this.dispatch()
      return
    }
    if (message.type === "copper_updated") {
      slot.copperUpdate?.resolve()
      slot.copperUpdate = undefined
      return
    }
    const active = slot.activeJob
    if (!active || active.job.jobId !== message.jobId) {
      this.handleWorkerFailure({
        slot,
        error: new Error(
          `${slot.workerId} returned unexpected job ${message.jobId}`,
        ),
      })
      return
    }
    slot.activeJob = undefined
    const queueWaitMs = Math.max(
      0,
      performance.now() - active.enqueuedAt - message.solveTimeMs,
    )
    active.resolve(
      message.type === "result"
        ? { status: "completed", response: message, queueWaitMs }
        : { status: "failed", response: message, queueWaitMs },
    )
    this.dispatch()
  }

  private handleWorkerFailure({
    slot,
    error,
  }: {
    slot: WorkerSlot
    error: Error
  }): void {
    slot.initialization?.reject(error)
    slot.initialization = undefined
    slot.copperUpdate?.reject(error)
    slot.copperUpdate = undefined
    if (slot.activeJob) {
      const active = slot.activeJob
      slot.activeJob = undefined
      active.resolve({
        status: "failed",
        response: {
          type: "job_failed",
          workerId: slot.workerId,
          jobId: active.job.jobId,
          code: "runtime_failure",
          message: error.message,
          solveTimeMs: 0,
          cpuTimeMs: 0,
        },
        queueWaitMs: performance.now() - active.enqueuedAt,
      })
    }
    if (!this.closing && !slot.restarting) void this.restartSlot(slot)
  }

  private async restartSlot(slot: WorkerSlot): Promise<void> {
    if (slot.restarting || this.closing) return
    slot.restarting = true
    slot.initialized = false
    const previousWorker = slot.worker
    previousWorker.removeAllListeners()
    await previousWorker.terminate()
    const replacement = this.createSlot(slot.slotIndex)
    replacement.worker.removeAllListeners()
    slot.workerId = replacement.workerId
    slot.worker = replacement.worker
    slot.initialized = false
    slot.restarting = false
    this.attachSlotListeners(slot)
    await this.initializeSlot(slot)
  }

  private dispatch(): void {
    for (const slot of this.slots) {
      if (!slot.initialized || slot.restarting || slot.activeJob) continue
      const pending = this.queue.shift()
      if (!pending) return
      slot.activeJob = pending
      slot.worker.postMessage({ type: "run", job: pending.job })
    }
  }

  private findPendingJob(jobId: string): PendingJob | undefined {
    return (
      this.queue.find((pending) => pending.job.jobId === jobId) ??
      this.slots.find((slot) => slot.activeJob?.job.jobId === jobId)?.activeJob
    )
  }
}

function validatePositiveInteger({
  value,
  name,
}: {
  value: number
  name: string
}): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}
