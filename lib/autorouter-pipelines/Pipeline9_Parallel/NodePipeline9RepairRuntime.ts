import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from "node:worker_threads"
import type {
  Pipeline9RepairRuntime,
  Pipeline9NegotiationTask,
  NegotiationResult,
} from "./pipeline9NegotiationTask"

type WorkerSlot = { worker: Worker; port: MessagePort; taskIndex?: number }
type Reply = { taskIndex: number; result: NegotiationResult } | { taskIndex: number; error: string }

// Report import failures over the port too: the caller may be in Atomics.wait(),
// where the main thread cannot dispatch Worker error events.
const WORKER_BOOTSTRAP = `
const { workerData } = require("node:worker_threads")
const { port, signal, moduleUrl, slotIndex } = workerData
const state = new Int32Array(signal)
const notify = () => { Atomics.add(state, 0, 1); Atomics.notify(state, 0) }
process.on("exit", () => { Atomics.store(state, slotIndex + 1, -1); notify() })
import(moduleUrl).then(({ runPipeline9NegotiationTask }) => {
  port.on("message", ({ taskIndex, task }) => {
    try { port.postMessage({ taskIndex, result: runPipeline9NegotiationTask(task) }) }
    catch (error) { port.postMessage({ taskIndex, error: String(error.stack || error) }) }
    notify()
  })
}).catch(error => { port.postMessage({ taskIndex: -1, error: String(error.stack || error) }); notify() })
`

/** A reusable synchronous worker pool. Results always follow input order. */
export class NodePipeline9RepairRuntime implements Pipeline9RepairRuntime {
  readonly workerCount: number
  private readonly signal: Int32Array
  private readonly slots: WorkerSlot[] = []
  private disposed = false
  private failure?: string
  private running = false

  constructor(workerCount = 8, readonly taskTimeoutMs = 120_000) {
    if (!Number.isSafeInteger(workerCount) || workerCount < 1) {
      throw new Error("Repair worker count must be a positive integer")
    }
    if (!Number.isFinite(taskTimeoutMs) || taskTimeoutMs <= 0) {
      throw new Error("Repair worker timeout must be positive and finite")
    }
    this.workerCount = workerCount
    this.signal = new Int32Array(new SharedArrayBuffer(4 * (workerCount + 1)))
  }

  runNegotiations(tasks: Pipeline9NegotiationTask[]): NegotiationResult[] {
    if (this.disposed) throw new Error("Repair runtime is disposed")
    if (this.failure) throw new Error(this.failure)
    if (this.running) throw new Error("Repair runtime cannot execute overlapping batches")
    if (tasks.length === 0) return []
    if (this.slots.length === 0) {
      const moduleUrl = new URL(import.meta.url.endsWith(".ts")
        ? "./pipeline9NegotiationTask.ts" : "./pipeline9NegotiationTask.js", import.meta.url).href
      for (let slotIndex = 0; slotIndex < this.workerCount; slotIndex++) {
        const { port1, port2 } = new MessageChannel()
        const worker = new Worker(WORKER_BOOTSTRAP, {
          eval: true,
          workerData: { port: port2, signal: this.signal.buffer, moduleUrl, slotIndex },
          transferList: [port2],
        })
        worker.on("error", (): void => { /* Synchronous callers receive errors through the port or shared exit state. */ })
        this.slots.push({ worker, port: port1 })
      }
    }
    this.running = true
    try {
      const results = new Array<NegotiationResult>(tasks.length)
      let next = 0, completed = 0
      const deadline = performance.now() + this.taskTimeoutMs
      while (completed < tasks.length) {
        const generation = Atomics.load(this.signal, 0)
        for (let index = 0; index < this.slots.length; index++) {
          const slot = this.slots[index]!
          const reply = receiveMessageOnPort(slot.port)?.message as Reply | undefined
          if (reply) {
            if ("error" in reply) throw new Error(`Repair worker failed: ${reply.error}`)
            if (reply.taskIndex !== slot.taskIndex) throw new Error("Repair worker returned an unexpected task")
            results[reply.taskIndex] = reply.result
            completed++
            slot.taskIndex = undefined
          }
          if (Atomics.load(this.signal, index + 1) === -1) throw new Error("Repair worker exited unexpectedly")
          if (slot.taskIndex === undefined && next < tasks.length) {
            slot.taskIndex = next++
            slot.port.postMessage({ taskIndex: slot.taskIndex, task: tasks[slot.taskIndex] })
          }
        }
        if (completed < tasks.length) {
          if (performance.now() >= deadline) throw new Error("Repair worker batch timed out")
          Atomics.wait(this.signal, 0, generation, Math.min(1000, deadline - performance.now()))
        }
      }
      return results
    } catch (error) {
      this.failure = `Repair runtime failed: ${error}`
      throw error
    } finally {
      this.running = false
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const slot of this.slots) slot.port.close()
    await Promise.all(this.slots.map(async (slot): Promise<void> => { await slot.worker.terminate() }))
    this.slots.length = 0
  }
}
