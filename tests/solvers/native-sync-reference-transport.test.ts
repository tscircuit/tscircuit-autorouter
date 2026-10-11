import { expect, test } from "bun:test"
import { MessageChannel, MessagePort } from "node:worker_threads"
import { initializeNativeSyncReferenceTransport, executeNativeSyncReferenceWorkerRequest,
  NativeSyncReferenceBatchTransport, NativeSyncReferenceReservationBook } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeSyncReferenceBatchTransport"
import { executeParallelReferenceContinuityBatch, prepareParallelReferenceContinuityContext } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityKernel"
import type { ParallelReferenceContinuityBatch, ParallelReferenceContinuityBatchResult } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityTypes"
import { assertNativeSyncReferenceResponse, assertParallelReferenceContinuityBatchResult,
  nativeSyncReferenceSchema, nativeSyncReferenceSchemaHash, type NativeSyncReferenceIdentity } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/nativeSyncReferenceProtocol"

test("synchronous reference reservations use owned ports, four CPU lanes and fatal bounded infrastructure failures", async () => {
  await initializeNativeSyncReferenceTransport()
  const traces = [
    { type: "pcb_trace", pcb_trace_id: "a", route: [{ route_type: "wire", layer: "top", x: -0, y: 0, width: 0.2 }, { route_type: "wire", layer: "top", x: 2, y: 0, width: 0.2 }] },
    { type: "pcb_trace", pcb_trace_id: "b", route: [{ route_type: "wire", layer: "top", x: 1, y: -1, width: 0.2 }, { route_type: "wire", layer: "top", x: 1, y: 1, width: 0.2 }] },
    { type: "pcb_trace", pcb_trace_id: "invalid", route: [null, null] },
  ]
  const context = prepareParallelReferenceContinuityContext({ snapshotId: 1, portCount: 65,
    tracePortOrdinals: [[0, 31, 32, 64], [32], []], components: [[0, 1, 0, 2], [2], []], geometryTraces: traces as any })
  const batch: ParallelReferenceContinuityBatch = { kind: "referenceContinuityFacts", context, tasks: [
    { kind: "port-connectivity", rowIndex: 0, componentIndex: 0, portOrdinal: 64 },
    { kind: "port-connectivity", rowIndex: 1, componentIndex: 0, portOrdinal: 63 },
    { kind: "port-connectivity", rowIndex: 2, componentIndex: 2, portOrdinal: 0 },
    { kind: "native-trace-pair-miss", rowIndex: 3, leftTraceIndex: 0, rightTraceIndex: 1 },
    { kind: "native-trace-pair-miss", rowIndex: 4, leftTraceIndex: 2, rightTraceIndex: 0 },
  ] }
  const native = executeParallelReferenceContinuityBatch(batch)
  const copy = structuredClone(context)
  const book = new NativeSyncReferenceReservationBook()
  const workers = Array.from({ length: 3 }, (): Worker => new Worker(new URL("../fixtures/native-sync-reference/worker.ts", import.meta.url)))
  let globalReplies = 0
  let taskId = 0
  const ordinary = async (worker: Worker, owner: NativeSyncReferenceReservationBook, mode?: string): Promise<void> => {
    owner.beginOrdinary(worker)
    const id = ++taskId
    await new Promise<void>((resolve, reject): void => {
      worker.onmessage = (event: MessageEvent): void => {
        globalReplies++
        if (event.data.taskId !== id || event.data.result !== "ordinary-completed") { reject(new Error("Unexpected ordinary acknowledgement")); return }
        owner.finishOrdinary(worker)
        resolve()
      }
      worker.onerror = (event: ErrorEvent): void => reject(event.error instanceof Error ? event.error : new Error(event.message))
      worker.postMessage({ kind: "ordinary", taskId: id, mode })
    })
  }
  try {
    for (const worker of workers) book.register(worker)
    expect(book.reserve()).toBeUndefined()
    await Promise.all(workers.map((worker): Promise<void> => ordinary(worker, book)))
    book.setQueuedCount(1)
    expect(book.reserve()).toBeUndefined()
    book.setQueuedCount(0)
    book.beginOrdinary(workers[0]!)
    expect(book.reserve()).toBeUndefined()
    book.finishOrdinary(workers[0]!)
    const transport = new NativeSyncReferenceBatchTransport(book)
    for (let round = 0; round < 4; round++) {
      const reservation = book.reserve()!
      expect(reservation.workers.length).toBe(3)
      expect(book.reserve()).toBeUndefined()
      expect(() => book.beginOrdinary(workers[0]!)).toThrow("consume a reference reservation")
      const groups = Array.from({ length: 4 }, (_, lane): ParallelReferenceContinuityBatch => ({ ...batch,
        tasks: batch.tasks.filter((_, index): boolean => index % 4 === lane) }))
      const result = transport.execute(reservation, workers.map((worker, lane): { worker: Worker; batch: ParallelReferenceContinuityBatch } => ({ worker, batch: groups[lane]! })), groups[3])
      const merged = result.flatMap((entry): ParallelReferenceContinuityBatchResult["facts"] => entry.facts).sort((a, b): number => a.rowIndex - b.rowIndex)
      expect(merged.map((fact): unknown => fact.status === "exception" ? { ...fact, exception: { ...fact.exception, stack: undefined } } : fact))
        .toEqual(native.facts.map((fact): unknown => fact.status === "exception" ? { ...fact, exception: { ...fact.exception, stack: undefined } } : fact))
      expect(globalReplies).toBe(3 + round)
      await ordinary(workers[0]!, book)
      expect(globalReplies).toBe(4 + round)
      expect(context).toEqual(copy)
    }
    expect(book.stats.batchesCompleted).toBe(4)
    expect(book.stats.workersReserved).toBe(12)
    expect(book.stats.workersRetired).toBe(12)
    expect(book.stats.mainFactRowsCompleted).toBe(4)
    expect(book.stats.factRowsCompleted).toBe(16)
    expect(book.stats.protocolFailures).toBe(0)
  } finally { for (const worker of workers) worker.terminate() }

  const identity: NativeSyncReferenceIdentity = { schema: nativeSyncReferenceSchema, schemaHash: nativeSyncReferenceSchemaHash,
    reservationId: 1, ordinal: 0, laneCount: 1, snapshotId: context.snapshotId, taskCount: batch.tasks.length }
  const response = { ...identity, status: "evaluated", result: native }
  expect(() => assertNativeSyncReferenceResponse(response, identity, batch)).not.toThrow()
  const variants: ((value: any) => void)[] = [
    (value): void => { value.schemaHash = "wrong" }, (value): void => { value.reservationId = 2 },
    (value): void => { value.ordinal = 1 }, (value): void => { value.taskCount = 4 },
    (value): void => { value.result.snapshotId++ }, (value): void => { value.result.facts.pop() },
    (value): void => { value.result.facts.reverse() }, (value): void => { value.result.facts[0].value = 1 },
    (value): void => { value.result.facts[1].consumedVisits = 0 }, (value): void => { value.result.facts[4].exception.stack = false },
    (value): void => { value.result.facts[4].exception = null }, (value): void => { value.result.facts[4].status = "unknown" },
  ]
  for (const mutate of variants) {
    const malformed = structuredClone(response)
    mutate(malformed)
    expect(() => assertNativeSyncReferenceResponse(malformed, identity, batch)).toThrow()
  }
  let observations = 0
  const getter = structuredClone(response)
  Object.defineProperty(getter.result.facts[4]!, "exception", { get(): unknown { observations++; throw new Error("observer") } })
  expect(() => assertParallelReferenceContinuityBatchResult(getter.result, batch)).toThrow("own data")
  expect(observations).toBe(0)
  const proxy = new Proxy(response, { getPrototypeOf(): object { observations++; return Object.prototype } })
  expect(() => assertNativeSyncReferenceResponse(proxy, identity, batch)).toThrow("non-proxy")
  expect(observations).toBe(0)

  for (const mode of ["stale", "duplicate", "malformed-unused", "bad-signal", "no-signal", "death"]) {
    const failedBook = new NativeSyncReferenceReservationBook()
    const worker = new Worker(new URL("../fixtures/native-sync-reference/worker.ts", import.meta.url))
    failedBook.register(worker)
    await ordinary(worker, failedBook, mode)
    const reservation = failedBook.reserve(1)!
    const transport = new NativeSyncReferenceBatchTransport(failedBook, 250)
    expect(() => transport.execute(reservation, [{ worker, batch }])).toThrow()
    expect(failedBook.stats.workersRetired).toBe(1)
    expect(failedBook.stats.protocolFailures).toBe(1)
    expect(() => failedBook.reserve()).toThrow()
    expect(() => failedBook.beginOrdinary(worker)).toThrow()
    worker.terminate()
  }
  const groupBook = new NativeSyncReferenceReservationBook()
  const groupWorkers = Array.from({ length: 3 }, (): Worker => new Worker(new URL("../fixtures/native-sync-reference/worker.ts", import.meta.url)))
  for (const worker of groupWorkers) groupBook.register(worker)
  await Promise.all(groupWorkers.map((worker, index): Promise<void> => ordinary(worker, groupBook, index === 1 ? "malformed-unused" : "native")))
  const groupReservation = groupBook.reserve()!
  expect(() => new NativeSyncReferenceBatchTransport(groupBook).execute(groupReservation,
    groupWorkers.map((worker): { worker: Worker; batch: ParallelReferenceContinuityBatch } => ({ worker, batch })))).toThrow()
  expect(groupBook.stats.workersReserved).toBe(3)
  expect(groupBook.stats.workersRetired).toBe(3)
  expect(groupBook.stats.batchesCompleted).toBe(0)
  expect(groupBook.stats.protocolFailures).toBe(1)
  for (const worker of groupWorkers) {
    expect(() => groupBook.beginOrdinary(worker)).toThrow()
    worker.terminate()
  }
  const disposed = new NativeSyncReferenceReservationBook()
  const disposedWorker = new Worker(new URL("../fixtures/native-sync-reference/worker.ts", import.meta.url))
  disposed.register(disposedWorker)
  await ordinary(disposedWorker, disposed)
  const disposedReservation = disposed.reserve(1)!
  const disposalError = new Error("disposed while reserved")
  disposed.fail(disposalError)
  expect(disposed.stats.workersRetired).toBe(1)
  expect(() => disposed.retire(disposedReservation)).toThrow()
  expect(() => disposed.reserve()).toThrow(disposalError)

  const malformedBook = new NativeSyncReferenceReservationBook()
  const malformedWorker = new Worker(new URL("../fixtures/native-sync-reference/worker.ts", import.meta.url))
  malformedBook.register(malformedWorker)
  await ordinary(malformedWorker, malformedBook)
  const malformedReservation = malformedBook.reserve(1)!
  expect(() => new NativeSyncReferenceBatchTransport(malformedBook).execute(malformedReservation, [])).toThrow()
  expect(malformedBook.stats.workersReserved).toBe(1)
  expect(malformedBook.stats.workersRetired).toBe(1)
  expect(malformedBook.stats.protocolFailures).toBe(1)
  expect(() => malformedBook.reserve()).toThrow()

  const channel = new MessageChannel()
  try {
    await expect(executeNativeSyncReferenceWorkerRequest({ ...identity, kind: "nativeSyncReferenceFacts", batch,
      port: Object.create(MessagePort.prototype), signal: new SharedArrayBuffer(4) })).rejects.toThrow()
    await expect(executeNativeSyncReferenceWorkerRequest({ ...identity, kind: "nativeSyncReferenceFacts", batch,
      port: channel.port2, signal: new SharedArrayBuffer(8) })).rejects.toThrow("terminal storage")
    await expect(executeNativeSyncReferenceWorkerRequest({ ...identity, kind: "nativeSyncReferenceFacts", batch,
      port: channel.port2, signal: Object.create(SharedArrayBuffer.prototype) })).rejects.toThrow()
  } finally { channel.port1.close(); channel.port2.close() }
})
