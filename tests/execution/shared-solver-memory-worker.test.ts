import { expect, test } from "bun:test"
import { Worker } from "node:worker_threads"
import { createSharedSolverBuffer } from "../../lib/execution/createSharedSolverBuffer"
import type { SolverSharedMemory } from "../../lib/execution/SolverExecutor"

test("native workers share snapshot storage and publish task-owned output", async (): Promise<void> => {
  const shared: SolverSharedMemory = {
    input: createSharedSolverBuffer(new Int32Array([10, 12, 20])),
    output: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  }
  const worker = new Worker(
    new URL("../fixtures/sharedSolverMemoryWorker.ts", import.meta.url),
  )
  try {
    const result = await new Promise<{ sum: number; inputIsShared: boolean }>(
      (resolve, reject) => {
        worker.once("message", resolve)
        worker.once("error", reject)
        worker.once("exit", (code) =>
          reject(new Error(`Shared memory worker exited before replying: ${code}`)),
        )
        worker.postMessage(shared)
      },
    )
    expect(result).toEqual({ sum: 42, inputIsShared: true })
    expect(Atomics.load(new Int32Array(shared.output), 0)).toBe(42)
    expect(new Int32Array(shared.input)).toEqual(new Int32Array([10, 12, 20]))
  } finally {
    await worker.terminate()
  }
})
