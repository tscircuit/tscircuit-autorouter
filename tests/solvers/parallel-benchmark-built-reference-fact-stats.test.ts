import { test, expect } from "bun:test"
import { createParallelBenchmarkReferenceFactStatsCollector } from "../../scripts/parallel-benchmark/collectParallelBenchmarkReferenceFactStats"
import { Pipeline9LocalWorkerPool as SourcePool } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"

test("benchmark collector captures genuine packaged private counters after disposal without observing shadows or source-brand instances", async () => {
  const packaged = await import("../../dist/index.js")
  const Class = packaged.Pipeline9LocalWorkerPool
  const collect = createParallelBenchmarkReferenceFactStatsCollector(packaged)
  const pool = new Class({ workerCount: 4 })
  const zero = { referenceReservationsGranted: 0, referenceReservationsDeclined: 0, referenceWorkersReserved: 0, referenceWorkersRetired: 0,
    referenceBatchesCompleted: 0, referenceWorkerFactRowsCompleted: 0, referenceMainFactRowsCompleted: 0, referenceProtocolFaults: 0,
    referenceMaxFactWorkerLanes: 0, referenceMainFactLaneCount: 0 }
  expect(collect(pool)).toEqual(zero)
  pool.dispose()
  expect(collect(pool)).toEqual(zero)
  let observations = 0
  Object.defineProperty(pool, "getNativeReferenceFactStats", { configurable: true, get(): never { observations++; throw new Error("own observer") } })
  expect(collect(pool)).toBeUndefined()
  expect(observations).toBe(0)
  delete (pool as unknown as Record<string, unknown>).getNativeReferenceFactStats
  const proxy = new Proxy(pool, { getPrototypeOf(): never { observations++; throw new Error("proxy prototype") }, get(): never { observations++; throw new Error("proxy getter") } })
  expect(collect(proxy)).toBeUndefined()
  expect(observations).toBe(0)
  const original = Object.getOwnPropertyDescriptor(Class.prototype, "getNativeReferenceFactStats")!
  Object.defineProperty(Class.prototype, "getNativeReferenceFactStats", { configurable: true, get(): never { observations++; throw new Error("prototype observer") } })
  try { expect(collect(pool)).toBeUndefined(); expect(observations).toBe(0) }
  finally { Object.defineProperty(Class.prototype, "getNativeReferenceFactStats", original) }
  const source = new SourcePool()
  source.dispose()
  expect(collect(source)).toBeUndefined()
  expect(collect(Object.create(Class.prototype))).toBeUndefined()
  const wrongModule = { get Pipeline9LocalWorkerPool(): never { observations++; throw new Error("module observer") } }
  expect(createParallelBenchmarkReferenceFactStatsCollector(wrongModule)(pool)).toBeUndefined()
  expect(observations).toBe(0)
  const returned = collect(pool)!
  returned.referenceBatchesCompleted = 100
  expect(collect(pool)).toEqual(zero)
})
