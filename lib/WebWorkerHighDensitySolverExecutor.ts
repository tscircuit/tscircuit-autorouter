import type {
  HighDensitySolverExecutor,
  HighDensitySolverExecutorSession,
  HighDensityNodeSolveResult,
  HighDensityNodeSolveTask,
  HighDensitySolverExecutionContext,
} from "./solvers/HighDensitySolver/high-density-parallel-types"
import type {
  HighDensityWorkerRequest,
  HighDensityWorkerResponse,
} from "./solvers/HighDensitySolver/high-density-worker-protocol"

type WorkerLike = {
  onmessage: ((event: MessageEvent<HighDensityWorkerResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: HighDensityWorkerRequest): void
  terminate(): void | Promise<number>
}

type WorkerSlot = {
  worker: WorkerLike
  ready: boolean
  resolveReady: () => void
  rejectReady: (error: Error) => void
  readyPromise: Promise<void>
  currentRequest?: {
    requestId: number
    resolve: (result: HighDensityNodeSolveResult) => void
    reject: (error: Error) => void
  }
}

type QueuedTask = {
  task: HighDensityNodeSolveTask
  resolve: (result: HighDensityNodeSolveResult) => void
  reject: (error: Error) => void
}

type WorkerFactory = () => WorkerLike

const createDefaultWorker = (): WorkerLike => {
  if (typeof Worker === "undefined") {
    throw new Error(
      "High-density parallel execution requires the Web Worker API or a custom highDensitySolverExecutor",
    )
  }
  return new Worker(
    new URL("./high-density-solver-worker.js", import.meta.url),
    { type: "module" },
  )
}

const createWorkerFromUrl = (workerUrl: string): WorkerLike => {
  if (typeof Worker === "undefined") {
    throw new Error(
      "High-density parallel execution requires the Web Worker API or a custom highDensitySolverExecutor",
    )
  }
  return new Worker(workerUrl, { type: "module" })
}

class WebWorkerHighDensitySolverSession
  implements HighDensitySolverExecutorSession
{
  private readonly slots: WorkerSlot[] = []
  private readonly queuedTasks: QueuedTask[] = []
  private nextRequestId = 1
  private disposed = false
  private failure: Error | null = null
  private readyPromise: Promise<void> = Promise.resolve()

  constructor(
    context: HighDensitySolverExecutionContext,
    parallelism: number,
    createWorker: WorkerFactory,
  ) {
    try {
      for (let workerIndex = 0; workerIndex < parallelism; workerIndex++) {
        let resolveReady!: () => void
        let rejectReady!: (error: Error) => void
        const readyPromise = new Promise<void>((resolve, reject) => {
          resolveReady = resolve
          rejectReady = reject
        })
        const slot: WorkerSlot = {
          worker: createWorker(),
          ready: false,
          resolveReady,
          rejectReady,
          readyPromise,
        }
        slot.worker.onmessage = (event) => {
          this.handleWorkerMessage(slot, event.data)
        }
        slot.worker.onerror = (event) => {
          this.fail(
            new Error(event.message || "High-density Web Worker failed"),
          )
        }
        slot.worker.onmessageerror = () => {
          this.fail(
            new Error("High-density Web Worker message was not cloneable"),
          )
        }
        this.slots.push(slot)
      }
    } catch (error) {
      for (const slot of this.slots) void slot.worker.terminate()
      throw this.toError(error)
    }

    this.readyPromise = Promise.all(
      this.slots.map((slot) => slot.readyPromise),
    ).then(() => undefined)
    void this.readyPromise.catch(() => undefined)

    for (const slot of this.slots) {
      try {
        slot.worker.postMessage({ type: "initialize", context })
      } catch (error) {
        this.fail(this.toError(error))
        break
      }
    }
  }

  async execute(
    task: HighDensityNodeSolveTask,
  ): Promise<HighDensityNodeSolveResult> {
    await this.readyPromise
    if (this.disposed) {
      const disposalError =
        this.failure ?? new Error("High-density executor session is disposed")
      throw disposalError
    }

    return await new Promise<HighDensityNodeSolveResult>((resolve, reject) => {
      this.queuedTasks.push({ task, resolve, reject })
      this.dispatchQueuedTasks()
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const disposeError =
      this.failure ?? new Error("High-density executor session was disposed")

    for (const queuedTask of this.queuedTasks.splice(0)) {
      queuedTask.reject(disposeError)
    }
    for (const slot of this.slots) {
      if (!slot.ready) slot.rejectReady(disposeError)
      slot.currentRequest?.reject(disposeError)
      slot.currentRequest = undefined
      void slot.worker.terminate()
    }
  }

  private handleWorkerMessage(
    slot: WorkerSlot,
    response: HighDensityWorkerResponse,
  ): void {
    if (this.disposed) return
    if (response.type === "ready") {
      slot.ready = true
      slot.resolveReady()
      this.dispatchQueuedTasks()
      return
    }

    if (response.type === "error") {
      this.fail(new Error(response.error))
      return
    }

    const currentRequest = slot.currentRequest
    if (!currentRequest || currentRequest.requestId !== response.requestId) {
      this.fail(
        new Error(
          `High-density Web Worker returned unexpected request ${response.requestId}`,
        ),
      )
      return
    }

    slot.currentRequest = undefined
    currentRequest.resolve(response.result)
    this.dispatchQueuedTasks()
  }

  private dispatchQueuedTasks(): void {
    if (this.disposed) return
    for (const slot of this.slots) {
      if (!slot.ready || slot.currentRequest || this.queuedTasks.length === 0) {
        continue
      }

      const queuedTask = this.queuedTasks.shift()!
      const requestId = this.nextRequestId
      this.nextRequestId += 1
      slot.currentRequest = {
        requestId,
        resolve: queuedTask.resolve,
        reject: queuedTask.reject,
      }
      try {
        slot.worker.postMessage({
          type: "solve",
          requestId,
          task: queuedTask.task,
        })
      } catch (error) {
        this.fail(this.toError(error))
      }
    }
  }

  private fail(error: Error): void {
    if (this.failure) return
    this.failure = error
    for (const slot of this.slots) {
      if (!slot.ready) slot.rejectReady(error)
    }
    this.dispose()
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}

/** Browser-compatible worker-pool implementation for the executor boundary. */
export class WebWorkerHighDensitySolverExecutor
  implements HighDensitySolverExecutor
{
  constructor(private readonly workerUrl?: string) {}

  createSession(
    context: HighDensitySolverExecutionContext,
    { parallelism }: { parallelism: number },
  ): HighDensitySolverExecutorSession {
    const workerUrl = this.workerUrl
    const createWorker = workerUrl
      ? () => createWorkerFromUrl(workerUrl)
      : createDefaultWorker
    return new WebWorkerHighDensitySolverSession(
      context,
      parallelism,
      createWorker,
    )
  }
}
