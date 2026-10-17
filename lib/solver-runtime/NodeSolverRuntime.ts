import type { SolverRuntime } from "./SolverRuntime"
import type { ParallelTaskBatch, ParallelTaskOutcome } from "./ParallelTaskBatch"
import { cloneTaskData } from "./cloneTaskData"

type NativeThreads = typeof import("node:worker_threads")
type Slot = { worker: import("node:worker_threads").Worker; port: import("node:worker_threads").MessagePort; index: number; taskIndex: number | null }
type WorkerMessage = { type: "ready" } | { type: "result"; batchId: number; outcome: ParallelTaskOutcome<unknown> } | { type: "fatal"; error: string }

const workerSource = `
const { workerData, MessageChannel, receiveMessageOnPort } = require("node:worker_threads")
const port = workerData.port
const signal = workerData.signal
const slot = workerData.slot
let stopping = false
let batchId = -1
let shared
const wake = () => { Atomics.add(signal, 0, 1); Atomics.notify(signal, 0) }
const failure = error => ({ name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error) })
process.on("exit", () => { if (!stopping) { Atomics.store(signal, slot + 1, -1); wake() } })
port.on("message", async message => {
  if (message.type === "stop") {
    stopping = true
    Atomics.store(signal, slot + 1, 3)
    wake()
    port.close()
    return
  }
  try {
    if (message.batchId !== batchId) { batchId = message.batchId; shared = message.shared }
    const module = await import(message.moduleUrl)
    const handler = module[message.exportName]
    if (typeof handler !== "function") throw new Error("Worker task export is not a function: " + message.exportName)
    let outcome
    try {
      const { port1, port2 } = new MessageChannel()
      let snapshot
      try {
        port1.postMessage({ value: shared })
        snapshot = receiveMessageOnPort(port2).message.value
      } finally { port1.close(); port2.close() }
      const output = handler(message.input, { shared: snapshot })
      if (output && typeof output.then === "function") throw new TypeError("Parallel solver tasks must return synchronously")
      outcome = { taskIndex: message.taskIndex, ok: true, output }
      port.postMessage({ type: "result", batchId, outcome })
    } catch (error) {
      port.postMessage({ type: "result", batchId, outcome: { taskIndex: message.taskIndex, ok: false, error: failure(error) } })
    }
    Atomics.store(signal, slot + 1, 1)
    wake()
  } catch (error) {
    port.postMessage({ type: "fatal", error: String(error) })
    Atomics.store(signal, slot + 1, -1)
    wake()
  }
})
port.postMessage({ type: "ready" })
Atomics.store(signal, slot + 1, 1)
wake()
`

/** Synchronous message-port collection keeps step() and solve() synchronous. */
export class NodeSolverRuntime implements SolverRuntime {
  private readonly native: NativeThreads
  private readonly signal: Int32Array
  private readonly slots: Slot[] = []
  private batchId = 0
  private disposed = false
  private running = false
  private fatal: string | null = null
  readonly threads: number

  constructor({ threads = 4 }: { threads?: number } = {}) {
    if (!Number.isSafeInteger(threads) || threads < 1) throw new Error("threads must be a positive integer")
    const host = globalThis as typeof globalThis & { process?: { getBuiltinModule?: (name: string) => unknown } }
    const native = host.process?.getBuiltinModule?.("node:worker_threads") as NativeThreads | undefined
    if (!native) throw new Error("NodeSolverRuntime requires a Node-compatible host with process.getBuiltinModule")
    this.native = native
    this.threads = threads
    this.signal = new Int32Array(new SharedArrayBuffer((threads + 1) * 4))
  }

  private startWorkers(): void {
    if (this.slots.length > 0) return
    for (let index = 0; index < this.threads; index++) {
      const { port1, port2 } = new this.native.MessageChannel()
      const worker = new this.native.Worker(workerSource, { eval: true, workerData: { port: port2, signal: this.signal, slot: index }, transferList: [port2] })
      worker.on("error", (error: Error): void => { this.fatal = error.message })
      this.slots.push({ worker, port: port1, index, taskIndex: null })
    }
    const deadline = Date.now() + 30_000
    while (this.slots.some((slot) => Atomics.load(this.signal, slot.index + 1) === 0)) {
      const signal = Atomics.load(this.signal, 0)
      for (const slot of this.slots) this.drain(slot, undefined)
      if (this.fatal || this.slots.some((slot) => Atomics.load(this.signal, slot.index + 1) < 0)) throw new Error(this.fatal ?? "Worker exited during startup")
      if (Date.now() >= deadline) throw new Error("Worker startup deadline exceeded")
      Atomics.wait(this.signal, 0, signal, 100)
    }
    for (const slot of this.slots) this.drain(slot, undefined)
  }

  private drain(slot: Slot, results: ParallelTaskOutcome<unknown>[] | undefined): void {
    for (;;) {
      const received = this.native.receiveMessageOnPort(slot.port)
      if (!received) return
      const message = received.message as WorkerMessage
      if (message.type === "ready") continue
      if (message.type === "fatal") { this.fatal = message.error; slot.taskIndex = null; continue }
      if (!results || message.batchId !== this.batchId || message.outcome.taskIndex !== slot.taskIndex) throw new Error("Worker response does not match the active task")
      results.push(message.outcome)
      slot.taskIndex = null
    }
  }

  runBatch<Input, Output, Shared>(batch: ParallelTaskBatch<Input, Output, Shared>): readonly ParallelTaskOutcome<Output>[] {
    if (this.disposed) throw new Error("Solver runtime has been disposed")
    if (this.running) throw new Error("NodeSolverRuntime does not permit overlapping synchronous batches")
    if (!batch.worker) throw new Error("A worker task module is required by NodeSolverRuntime")
    if (batch.inputs.length === 0) return []
    this.startWorkers()
    const inputs = cloneTaskData(batch.inputs)
    const shared = cloneTaskData(batch.shared)
    this.running = true
    this.batchId++
    const results: ParallelTaskOutcome<unknown>[] = []
    let next = 0
    const sentShared = new Set<number>()
    try {
      while (results.length < inputs.length) {
        const signal = Atomics.load(this.signal, 0)
        for (const slot of this.slots) this.drain(slot, results)
        for (const slot of this.slots) {
          if (Atomics.load(this.signal, slot.index + 1) < 0) { this.fatal ??= "Worker exited unexpectedly"; slot.taskIndex = null }
          if (this.fatal || slot.taskIndex !== null || next >= inputs.length) continue
          slot.taskIndex = next
          slot.port.postMessage({ type: "execute", batchId: this.batchId, taskIndex: next, input: inputs[next], ...(sentShared.has(slot.index) ? {} : { shared }), ...batch.worker })
          sentShared.add(slot.index)
          next++
        }
        if (this.fatal && this.slots.every((slot) => slot.taskIndex === null)) throw new Error(this.fatal)
        if (results.length < inputs.length) Atomics.wait(this.signal, 0, signal, 100)
      }
      return results as ParallelTaskOutcome<Output>[]
    } finally { this.running = false }
  }

  dispose(): void {
    if (this.disposed) return
    if (this.running) throw new Error("Cannot dispose a runtime during a synchronous batch")
    this.disposed = true
    for (const slot of this.slots) if (Atomics.load(this.signal, slot.index + 1) >= 0) slot.port.postMessage({ type: "stop" })
    const deadline = Date.now() + 30_000
    while (this.slots.some((slot) => { const status = Atomics.load(this.signal, slot.index + 1); return status >= 0 && status !== 3 })) {
      if (Date.now() >= deadline) throw new Error("Worker shutdown deadline exceeded")
      const signal = Atomics.load(this.signal, 0)
      Atomics.wait(this.signal, 0, signal, 100)
    }
    for (const slot of this.slots) { slot.port.close(); void slot.worker.terminate() }
  }
}
