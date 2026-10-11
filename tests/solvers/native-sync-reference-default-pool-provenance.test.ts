import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool, getNativeSyncReferencePoolBinding } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { canAdmitNativeSyncReferenceFacts, createNativeSyncReferenceFactExecutor, initializeNativeSyncReferenceTransport,
  isNativeSyncReferenceFactExecutor } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeSyncReferenceBatchTransport"
import { executeParallelReferenceContinuityBatch, prepareParallelReferenceContinuityContext } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityKernel"
import type { ParallelReferenceContinuityBatch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityTypes"

test("only ready native default-pool workers can supply reference facts and terminal failures remain fatal", async () => {
  await initializeNativeSyncReferenceTransport()
  const batch: ParallelReferenceContinuityBatch = { kind: "referenceContinuityFacts",
    context: prepareParallelReferenceContinuityContext({ snapshotId: 1, portCount: 3,
      tracePortOrdinals: [[0], [1]], components: [[0, 1], [1], []] }),
    tasks: Array.from({ length: 12 }, (_, rowIndex): ParallelReferenceContinuityBatch["tasks"][number] => ({
      kind: "port-connectivity", rowIndex, componentIndex: rowIndex % 3, portOrdinal: rowIndex % 3,
    })) }
  const expected = executeParallelReferenceContinuityBatch(batch)
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  try {
    await pool.initializeReferenceTransport()
    const executor = createNativeSyncReferenceFactExecutor(pool)!
    expect(isNativeSyncReferenceFactExecutor(executor)).toBe(true)
    expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(false)
    expect(executor(batch)).toBeUndefined()
    pool.start()
    expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(false)
    const pending = pool.warmup()
    expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(false)
    expect(executor(batch)).toBeUndefined()
    await pending
    expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(true)
    expect(executor(batch)).toEqual(expected)
    const binding = getNativeSyncReferencePoolBinding(pool)!
    expect(binding.book.stats.workersReserved).toBe(3)
    expect(binding.book.stats.workersRetired).toBe(3)
    expect(binding.book.stats.batchesCompleted).toBe(1)
    expect(binding.book.stats.mainFactRowsCompleted).toBeGreaterThan(0)
    expect(binding.book.stats.factRowsCompleted + binding.book.stats.mainFactRowsCompleted).toBe(batch.tasks.length)
    expect(pool.stats.tasksStarted).toBe(4)
    expect(pool.stats.tasksCompleted).toBe(4)
    await pool.warmup()
    expect(pool.stats.tasksStarted).toBe(8)
    expect(pool.stats.tasksCompleted).toBe(8)
    expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(true)
    expect(executor(batch)).toEqual(expected)

    let controlReads = 0
    const deadlineDescriptor = Object.getOwnPropertyDescriptor(binding.transport, "deadlineMs")!
    Object.defineProperty(binding.transport, "deadlineMs", { configurable: true, get(): never { controlReads++; throw new Error("observer") } })
    expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(false)
    expect(executor(batch)).toBeUndefined()
    expect(controlReads).toBe(0)
    Object.defineProperty(binding.transport, "deadlineMs", deadlineDescriptor)
    Object.defineProperty(binding.transport, "execute", { configurable: true, get(): never { controlReads++; throw new Error("observer") } })
    expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(false)
    expect(executor(batch)).toBeUndefined()
    expect(controlReads).toBe(0)
    delete (binding.transport as unknown as Record<string, unknown>).execute
    Object.defineProperty(binding.book, "retire", { configurable: true, get(): never { controlReads++; throw new Error("observer") } })
    expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(false)
    expect(executor(batch)).toBeUndefined()
    expect(controlReads).toBe(0)
    delete (binding.book as unknown as Record<string, unknown>).retire
    expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(true)

    const nativeSlots = (pool as unknown as { workers: { worker: Worker }[] }).workers
    const originalBookSlots = (binding.book as unknown as { slots: { worker: Worker; state: string }[] }).slots
    const foreign = new Worker(new URL("../fixtures/native-sync-reference/worker.ts", import.meta.url))
    try {
      const oldWorker = originalBookSlots[0]!.worker
      originalBookSlots[0]!.worker = foreign
      expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(false)
      expect(executor(batch)).toBeUndefined()
      expect(binding.book.stats.batchesCompleted).toBe(2)
      originalBookSlots[0]!.worker = oldWorker
      expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(true)
      const oldPoolWorker = nativeSlots[0]!.worker
      nativeSlots[0]!.worker = foreign
      originalBookSlots[0]!.worker = foreign
      expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(false)
      expect(executor(batch)).toBeUndefined()
      nativeSlots[0]!.worker = oldPoolWorker
      originalBookSlots[0]!.worker = oldWorker
      expect(canAdmitNativeSyncReferenceFacts(executor)).toBe(true)
    } finally { foreign.terminate() }

    const sentinel = new Error("native reference infrastructure failed")
    binding.book.fail(sentinel)
    let probeError: unknown, executionError: unknown
    try { canAdmitNativeSyncReferenceFacts(executor) } catch (error: unknown) { probeError = error }
    try { executor(batch) } catch (error: unknown) { executionError = error }
    expect(probeError).toBe(sentinel)
    expect(executionError).toBe(sentinel)
    await expect(pool.run({ kind: "warmup" })).rejects.toBe(sentinel)
  } finally { pool.dispose() }

  const cold = new Pipeline9LocalWorkerPool()
  const foreign = new Worker(new URL("../fixtures/native-sync-reference/worker.ts", import.meta.url))
  try {
    const binding = getNativeSyncReferencePoolBinding(cold)!
    binding.book.register(foreign)
    binding.book.beginOrdinary(foreign)
    binding.book.finishOrdinary(foreign)
    const forged = createNativeSyncReferenceFactExecutor(cold)
    expect(forged).toBeUndefined()
    expect(isNativeSyncReferenceFactExecutor(forged)).toBe(false)
    expect(canAdmitNativeSyncReferenceFacts(forged)).toBe(false)
  } finally { foreign.terminate(); cold.dispose() }
  const custom = new Pipeline9LocalWorkerPool({ workerUrl: new URL("../fixtures/native-sync-reference/worker.ts", import.meta.url) })
  try {
    await custom.initializeReferenceTransport()
    expect(createNativeSyncReferenceFactExecutor(custom)).toBeUndefined()
    expect(isNativeSyncReferenceFactExecutor((): undefined => undefined)).toBe(false)
    let observations = 0
    const proxy = new Proxy((): undefined => undefined, { get(): never { observations++; throw new Error("observer") } })
    expect(isNativeSyncReferenceFactExecutor(proxy)).toBe(false)
    expect(canAdmitNativeSyncReferenceFacts(proxy)).toBe(false)
    expect(observations).toBe(0)
  } finally { custom.dispose() }
})
