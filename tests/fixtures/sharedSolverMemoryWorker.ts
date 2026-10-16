import { parentPort } from "node:worker_threads"
import type { SolverSharedMemory } from "../../lib/execution/SolverExecutor"

if (!parentPort) throw new Error("Shared solver memory fixture requires a worker")

parentPort.on("message", (shared: SolverSharedMemory): void => {
  const values = new Int32Array(shared.input)
  const output = new Int32Array(shared.output)
  const sum = values.reduce((total, value) => total + value, 0)
  Atomics.store(output, 0, sum)
  parentPort!.postMessage({
    sum,
    inputIsShared: shared.input instanceof SharedArrayBuffer,
  })
})
