import { Worker } from "node:worker_threads"
import type {
  HighDensityRepairSampleInput,
  HighDensityRepairSampleResult,
} from "../../lib/solvers/HighDensityRepairSolver/solveHighDensityRepairSample"
import type { ParallelRepairWorkerMessage, ParallelRepairWorkerRequest } from "./parallelRepairWorker"

type RepairWorkerSlot = {
  worker: Worker
  task?: {
    requestId: number
    start: number
    nodeId: string | undefined
    routeCount: number
    pointCount: number
    fixedRouteCount: number
    resolve: (value: HighDensityRepairSampleResult) => void
    reject: (error: Error) => void
  }
}

type RepairWorkerMetadata = Extract<ParallelRepairWorkerMessage, { kind: "ready" }>

/** Persistent benchmark pool. The repair stage bounds in-flight dispatch, so no second queue is needed. */
export class ParallelRepairWorkerPool {
  readonly timings: { nodeId: string | undefined; routeCount: number; pointCount: number; fixedRouteCount: number; solveMs: number; roundTripMs: number; candidates: number }[] = []
  readonly ready: Promise<RepairWorkerMetadata[]>
  private readonly slots: RepairWorkerSlot[] = []
  private nextRequestId = 0
  private failure?: Error
  private closing = false

  constructor(workerCount: number) {
    const readiness: Promise<RepairWorkerMetadata>[] = []
    for (let index = 0; index < workerCount; index++) {
      const slot: RepairWorkerSlot = {
        worker: new Worker(new URL("./parallelRepairWorker.ts", import.meta.url)),
      }
      this.slots.push(slot)
      readiness.push(new Promise((resolve, reject): void => {
        let ready = false
        slot.worker.on("message", (message: ParallelRepairWorkerMessage): void => {
          if (message.kind === "ready") {
            ready = true
            resolve(message)
            return
          }
          const task = slot.task
          if (!task || task.requestId !== message.requestId) {
            this.fail(new Error("Repair worker returned an unknown request ID"))
            return
          }
          slot.task = undefined
          if (message.kind === "result") {
            this.timings.push({ nodeId: task.nodeId, routeCount: task.routeCount, pointCount: task.pointCount, fixedRouteCount: task.fixedRouteCount, solveMs: message.solveMs, roundTripMs: performance.now() - task.start, candidates: message.value.stats.nodeClearanceCandidateCount })
            task.resolve(message.value)
          }
          else task.reject(new Error(message.error))
        })
        slot.worker.on("error", (error: Error): void => {
          reject(error)
          this.fail(error)
        })
        slot.worker.on("exit", (code: number): void => {
          if (this.closing) return
          const error = new Error(`Repair worker exited unexpectedly (${code})`)
          if (!ready) reject(error)
          this.fail(error)
        })
      }))
    }
    this.ready = Promise.all(readiness)
  }

  private fail(error: Error): void {
    this.failure = error
    for (const slot of this.slots) {
      slot.task?.reject(error)
      slot.task = undefined
    }
  }

  execute(input: HighDensityRepairSampleInput): Promise<HighDensityRepairSampleResult> {
    if (this.failure) return Promise.reject(this.failure)
    const slot = this.slots.find((candidate): boolean => !candidate.task)
    if (!slot || this.closing) {
      return Promise.reject(new Error("Repair benchmark dispatched beyond the pool capacity"))
    }
    return new Promise((resolve, reject): void => {
      const requestId = this.nextRequestId++
      slot.task = {
        requestId, resolve, reject, start: performance.now(),
        nodeId: input.sample.nodeWithPortPoints?.capacityMeshNodeId,
        routeCount: input.sample.nodeHdRoutes?.length ?? 0,
        pointCount: input.sample.nodeHdRoutes?.reduce((sum, route): number => sum + (route.route?.length ?? 0), 0) ?? 0,
        fixedRouteCount: input.sample.fixedHdRoutes?.length ?? 0,
      }
      slot.worker.postMessage({ requestId, input } satisfies ParallelRepairWorkerRequest)
    })
  }

  async close(): Promise<void> {
    this.closing = true
    this.fail(new Error("Repair worker pool closed"))
    await Promise.all(this.slots.map((slot): Promise<number> => slot.worker.terminate()))
  }
}
