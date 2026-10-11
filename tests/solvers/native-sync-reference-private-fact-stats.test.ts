import { expect, test } from "bun:test"
import { Pipeline9LocalWorkerPool, getNativeSyncReferencePoolBinding } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { createNativeSyncReferenceFactExecutor } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeSyncReferenceBatchTransport"
import { prepareParallelReferenceContinuityContext } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityKernel"
import type { ParallelReferenceContinuityBatch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityTypes"

test("private native fact snapshots count globally validated work and retain callback-free provenance after disposal", async () => {
  const method = Object.getOwnPropertyDescriptor(Pipeline9LocalWorkerPool.prototype, "getNativeReferenceFactStats")!.value as Pipeline9LocalWorkerPool["getNativeReferenceFactStats"]
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  await pool.initializeReferenceTransport()
  const zero = { reservationsGranted: 0, reservationsDeclined: 0, workersReserved: 0, workersRetired: 0,
    batchesCompleted: 0, workerFactRowsCompleted: 0, mainFactRowsCompleted: 0, protocolFaults: 0,
    maxFactWorkerLanes: 0, mainFactLaneCount: 0 }
  expect(method.call(pool)).toEqual(zero)
  await pool.warmup()
  const batch: ParallelReferenceContinuityBatch = { kind: "referenceContinuityFacts",
    context: prepareParallelReferenceContinuityContext({ snapshotId: 11, portCount: 3, tracePortOrdinals: [[0], [1]], components: [[0, 1], [0]],
      geometryTraces: [
        { type: "pcb_trace", pcb_trace_id: "invalid", route: [null, null] },
        { type: "pcb_trace", pcb_trace_id: "valid", route: [{ route_type: "wire", x: 0, y: 0, width: 0.1 }, { route_type: "wire", x: 1, y: 1, width: 0.1 }] },
      ] as any }),
    tasks: [
      { kind: "port-connectivity", rowIndex: 0, componentIndex: 0, portOrdinal: 1 },
      { kind: "port-connectivity", rowIndex: 1, componentIndex: 1, portOrdinal: 2 },
      { kind: "native-trace-pair-miss", rowIndex: 2, leftTraceIndex: 0, rightTraceIndex: 1 },
      { kind: "native-trace-pair-miss", rowIndex: 3, leftTraceIndex: 1, rightTraceIndex: 0 },
    ] }
  const executor = createNativeSyncReferenceFactExecutor(pool)!
  const result = executor(batch)!
  expect(result.facts.filter((fact): boolean => fact.status === "exception")).toHaveLength(2)
  const first = method.call(pool)!
  expect(first.reservationsGranted).toBe(1)
  expect(first.workersReserved).toBe(3)
  expect(first.workersRetired).toBe(3)
  expect(first.batchesCompleted).toBe(1)
  expect(first.workerFactRowsCompleted + first.mainFactRowsCompleted).toBe(4)
  expect(first.mainFactRowsCompleted).toBeGreaterThan(0)
  expect(first.protocolFaults).toBe(0)
  expect(first.maxFactWorkerLanes).toBe(3)
  expect(first.mainFactLaneCount).toBe(1)
  first.batchesCompleted = 100
  expect(method.call(pool)!.batchesCompleted).toBe(1)

  let observations = 0
  Object.defineProperty(pool, "getNativeReferenceFactStats", { configurable: true,
    get(): never { observations++; throw new Error("snapshot observer") } })
  expect(method.call(pool)).toBeUndefined()
  expect(observations).toBe(0)
  delete (pool as unknown as Record<string, unknown>).getNativeReferenceFactStats
  Object.defineProperty(pool, "getNativeReferenceFactStats", { configurable: true, value: (): never => { observations++; throw new Error("snapshot callback") } })
  expect(method.call(pool)).toBeUndefined()
  expect(observations).toBe(0)
  delete (pool as unknown as Record<string, unknown>).getNativeReferenceFactStats
  const proxy = new Proxy(pool, { getPrototypeOf(): never { observations++; throw new Error("proxy observer") }, get(): never { observations++; throw new Error("proxy read") } })
  expect(method.call(proxy)).toBeUndefined()
  expect(observations).toBe(0)
  const prototype = Object.getOwnPropertyDescriptor(Pipeline9LocalWorkerPool.prototype, "getNativeReferenceFactStats")!
  Object.defineProperty(Pipeline9LocalWorkerPool.prototype, "getNativeReferenceFactStats", { configurable: true, get(): never { observations++; throw new Error("prototype observer") } })
  try { expect(method.call(pool)).toBeUndefined(); expect(observations).toBe(0) }
  finally { Object.defineProperty(Pipeline9LocalWorkerPool.prototype, "getNativeReferenceFactStats", prototype) }
  const book = getNativeSyncReferencePoolBinding(pool)!.book
  Object.defineProperty(book.stats, "batchesCompleted", { configurable: true, get(): never { observations++; throw new Error("public counter observer") } })
  expect(method.call(pool)!.batchesCompleted).toBe(1)
  pool.dispose()
  expect(method.call(pool)!.protocolFaults).toBe(0)
  expect(method.call(pool)!.batchesCompleted).toBe(1)
  expect(observations).toBe(0)

  const ordinaryDisposed = new Pipeline9LocalWorkerPool()
  ordinaryDisposed.dispose()
  expect(method.call(ordinaryDisposed)).toEqual(zero)
  const custom = new Pipeline9LocalWorkerPool({ workerUrl: new URL("../fixtures/native-sync-reference/worker.ts", import.meta.url) })
  expect(method.call(custom)).toBeUndefined()
  custom.dispose()
  class DerivedPool extends Pipeline9LocalWorkerPool {}
  const derived = new DerivedPool()
  expect(method.call(derived)).toBeUndefined()
  derived.dispose()

  const failed = new Pipeline9LocalWorkerPool()
  try {
    await failed.initializeReferenceTransport()
    await failed.warmup()
    const malformed: ParallelReferenceContinuityBatch = { ...structuredClone(batch), tasks: [
      { kind: "native-trace-pair-miss", rowIndex: 0, leftTraceIndex: 100, rightTraceIndex: 0 }, ...batch.tasks.slice(1),
    ] }
    expect(() => createNativeSyncReferenceFactExecutor(failed)!(malformed)).toThrow()
    const counts = method.call(failed)!
    expect(counts.reservationsGranted).toBe(1)
    expect(counts.workersReserved).toBe(3)
    expect(counts.workersRetired).toBe(3)
    expect(counts.batchesCompleted).toBe(0)
    expect(counts.workerFactRowsCompleted).toBe(0)
    expect(counts.mainFactRowsCompleted).toBe(0)
    expect(counts.protocolFaults).toBe(1)
    failed.dispose()
    expect(method.call(failed)!.protocolFaults).toBe(1)
  } finally { failed.dispose() }
})
