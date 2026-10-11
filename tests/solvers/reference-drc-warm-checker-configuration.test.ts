import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Pipeline9LocalWorkerPool, getNativeSyncReferencePoolBinding } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { createNativeSyncReferenceFactExecutor, initializeNativeSyncReferenceTransport } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeSyncReferenceBatchTransport"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { configurePreparedPrivatelyMemoizedTraceContinuityChecker, createPrivatelyMemoizedTraceContinuityChecker } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"

test("late minted executor binding preserves the warm private checker and rejects observer-bearing identities without reads", async () => {
  await initializeNativeSyncReferenceTransport()
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  await pool.initializeReferenceTransport()
  await pool.warmup()
  try {
    const executor = createNativeSyncReferenceFactExecutor(pool)
    expect(executor).toBeDefined()
    const ledger = getNativeSyncReferencePoolBinding(pool)!.book
    let events = 0
    const observedFunction = new Proxy(() => { events++; throw new Error("supplied callback") }, {
      get(): never { events++; throw new Error("identity getter") },
      getPrototypeOf(): never { events++; throw new Error("identity prototype") },
      ownKeys(): never { events++; throw new Error("identity keys") },
      getOwnPropertyDescriptor(): never { events++; throw new Error("identity descriptor") },
      apply(): never { events++; throw new Error("identity call") },
    })
    const observedRecord = new Proxy({ executor }, { get(): never { events++; throw new Error("record read") }, getPrototypeOf(): never { events++; throw new Error("record prototype") } })
    expect(configurePreparedPrivatelyMemoizedTraceContinuityChecker(observedFunction, executor)).toBe(false)
    expect(configurePreparedPrivatelyMemoizedTraceContinuityChecker(observedRecord, executor)).toBe(false)
    expect(configurePreparedPrivatelyMemoizedTraceContinuityChecker(createPrivatelyMemoizedTraceContinuityChecker(), observedFunction)).toBe(false)
    for (const value of [undefined, null, 1, "checker", Symbol("checker"), {}, (): void => {}]) {
      expect(configurePreparedPrivatelyMemoizedTraceContinuityChecker(value, executor)).toBe(false)
    }
    expect(events).toBe(0)
    expect(ledger.stats.reservationsGranted).toBe(0)

    const repo = resolve(import.meta.dir, "../.."), work = mkdtempSync(join(tmpdir(), "reference-warm-binding-"))
    symlinkSync(join(repo, "node_modules"), join(work, "node_modules"))
    const base = join(repo, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork")
    const sources = { checker: join(base, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts"), index: join(base, "native/lib/util/create-indexed-pcb-connectivity-map.ts"), planner: join(base, "referenceDrcPrimitiveMissPlanning.ts"), prepare: join(base, "prepareReferenceDrcTracePairFacts.ts") }
    const copies = { checker: join(work, "checker.ts"), index: join(work, "index.ts"), planner: join(work, "planner.ts"), prepare: join(work, "prepare.ts") }
    for (const kind of Object.keys(sources) as (keyof typeof sources)[]) {
      let source = readFileSync(sources[kind], "utf8")
      if (kind === "checker") source = "export let latestPrivateMemo: unknown\n" + source.replaceAll("const primitiveMemo = new ReferenceDrcPrimitiveMemo()", "const primitiveMemo = new ReferenceDrcPrimitiveMemo()\n  latestPrivateMemo = primitiveMemo")
      source = source.replace(/from\s+"(\.[^"]+)"/g, (_match, spec: string): string => {
        let target = resolve(dirname(sources[kind]), spec)
        if (spec.includes("check-traces-are-contiguous/check-traces-are-contiguous")) target = copies.checker
        else if (spec.endsWith("create-indexed-pcb-connectivity-map")) target = copies.index
        else if (spec.endsWith("referenceDrcPrimitiveMissPlanning")) target = copies.planner
        else if (spec.endsWith("prepareReferenceDrcTracePairFacts")) target = copies.prepare
        return `from ${JSON.stringify(target)}`
      })
      writeFileSync(copies[kind], source)
    }
    const module = await import(copies.checker)
    const native = module.createPrivatelyMemoizedTraceContinuityChecker()
    const nativeMemo = module.latestPrivateMemo as ReferenceDrcPrimitiveMemo
    const candidate = module.createPrivatelyMemoizedTraceContinuityChecker()
    const originalMemo = module.latestPrivateMemo as ReferenceDrcPrimitiveMemo
    const state = (memo: ReferenceDrcPrimitiveMemo): unknown => ({ diagnostics: { ...memo.diagnostics }, identities: [...(memo as any).identities], nextIdentity: (memo as any).nextIdentity, values: [...(memo as any).values] })
    const circuit = (): any[] => [0,1,2].map((i): any => ({ type: "pcb_trace", pcb_trace_id: `trace${i}`, route: [{ route_type: "wire", x: -1, y: i * 0.01, width: 0.1, layer: "top" }, { route_type: "wire", x: 1, y: i * 0.01, width: 0.1, layer: "top" }] }))
    expect(candidate(circuit())).toEqual(native(circuit()))
    expect(state(originalMemo)).toEqual(state(nativeMemo))
    const beforeConfiguration = state(originalMemo)
    expect(module.configurePreparedPrivatelyMemoizedTraceContinuityChecker(candidate, observedFunction)).toBe(false)
    expect(state(originalMemo)).toEqual(beforeConfiguration); expect(events).toBe(0)
    expect(module.configurePreparedPrivatelyMemoizedTraceContinuityChecker(candidate, executor)).toBe(true)
    expect(module.latestPrivateMemo).toBe(originalMemo)
    expect(state(originalMemo)).toEqual(beforeConfiguration)
    expect(candidate(circuit())).toEqual(native(circuit()))
    expect(state(originalMemo)).toEqual(state(nativeMemo))
    expect(ledger.stats.factRowsCompleted).toBe(0); expect(ledger.stats.mainFactRowsCompleted).toBe(0)
    const changed = circuit(), nativeChanged = circuit()
    changed[0].route[0].x = -1.01; nativeChanged[0].route[0].x = -1.01
    expect(candidate(changed)).toEqual(native(nativeChanged))
    expect(state(originalMemo)).toEqual(state(nativeMemo)); expect(changed).toEqual(nativeChanged)
    expect(ledger.stats.factRowsCompleted + ledger.stats.mainFactRowsCompleted).toBe(2)
    expect(ledger.stats.batchesCompleted).toBe(1); expect(ledger.stats.workersReserved).toBe(1)
    expect(ledger.stats.workersRetired).toBe(1); expect(ledger.stats.protocolFailures).toBe(0)
    expect(module.configurePreparedPrivatelyMemoizedTraceContinuityChecker(candidate, executor)).toBe(true)
    expect(candidate(changed)).toEqual(native(nativeChanged)); expect(state(originalMemo)).toEqual(state(nativeMemo))
    expect(ledger.stats.batchesCompleted).toBe(1)
    expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
  } finally { await pool.dispose() }
})
