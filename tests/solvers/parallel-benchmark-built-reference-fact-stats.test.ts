import { test, expect } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createParallelBenchmarkReferenceFactStatsCollector } from "../../scripts/parallel-benchmark/collectParallelBenchmarkReferenceFactStats"
import { Pipeline9LocalWorkerPool as SourcePool } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"

test("benchmark collector captures genuine packaged private counters after disposal without observing shadows or source-brand instances", async () => {
  const repository = fileURLToPath(new URL("../../", import.meta.url))
  const temporary = await mkdtemp(join(tmpdir(), "parallel-benchmark-package-"))
  let pool: SourcePool | undefined
  try {
    const output = join(temporary, "dist")
    await symlink(join(repository, "node_modules"), join(temporary, "node_modules"), "dir")
    execFileSync(process.execPath, ["run", "build", "--out-dir", output], { cwd: repository, encoding: "utf8", stdio: "pipe" })
    const packaged = await import(pathToFileURL(join(output, "index.js")).href)
    const Class = packaged.Pipeline9LocalWorkerPool as typeof SourcePool
    const collect = createParallelBenchmarkReferenceFactStatsCollector(packaged)
    pool = new Class({ workerCount: 4 })
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
  } finally {
    try { pool?.dispose() }
    finally { await rm(temporary, { recursive: true, force: true }) }
  }
})
