import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { Pipeline9LocalWorkerPool, getNativeSyncReferencePoolBinding } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/Pipeline9LocalWorkerPool"
import { createMemoizedReferenceDrcEvaluator, configurePreparedMemoizedReferenceDrcEvaluator } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/createMemoizedReferenceDrcEvaluator"
import { bindNativeReferenceDrcEvaluatorToPool, initializeNativeReferenceDrcPoolForOwner } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/bindNativeReferenceDrcEvaluatorToPool"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { initializeNativeSyncReferenceTransport } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/NativeSyncReferenceBatchTransport"
import type { EvaluateRelaxedDrcInput } from "../../lib/testing/evaluate-relaxed-drc"

test("private evaluator binds the same warm checker to native pool facts without reading unsupported owner or evaluator hooks", async () => {
  await initializeNativeSyncReferenceTransport()
  const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
  const owner = { workerPool: pool }
  const initialize = initializeNativeReferenceDrcPoolForOwner(owner)
  expect(initialize).toBeDefined()
  await initialize
  await pool.warmup()
  try {
    const ledger = getNativeSyncReferencePoolBinding(pool)!.book
    let callbacks = 0
    const observed = new Proxy((): never => { callbacks++; throw new Error("caller evaluator") }, {
      get(): never { callbacks++; throw new Error("caller field") },
      getOwnPropertyDescriptor(): never { callbacks++; throw new Error("caller descriptor") },
      ownKeys(): never { callbacks++; throw new Error("caller keys") },
      getPrototypeOf(): never { callbacks++; throw new Error("caller prototype") },
      apply(): never { callbacks++; throw new Error("caller apply") },
    })
    const ownerGetter = Object.defineProperty({}, "workerPool", { get(): never { callbacks++; throw new Error("owner pool getter") } })
    const ownerProxy = new Proxy(owner, { getOwnPropertyDescriptor(): never { callbacks++; throw new Error("proxy owner descriptor") } })
    const customPool = { initializeReferenceTransport: observed, run: observed }
    for (const unsupported of [ownerGetter, ownerProxy, { workerPool: customPool }, {}, undefined]) {
      expect(initializeNativeReferenceDrcPoolForOwner(unsupported)).toBeUndefined()
      expect(bindNativeReferenceDrcEvaluatorToPool(unsupported, observed)).toBe(false)
    }
    expect(bindNativeReferenceDrcEvaluatorToPool(owner, observed)).toBe(false)
    expect(configurePreparedMemoizedReferenceDrcEvaluator(observed, observed)).toBe(false)
    expect(bindNativeReferenceDrcEvaluatorToPool(owner, createMemoizedReferenceDrcEvaluator(new ReferenceDrcPrimitiveMemo()))).toBe(false)
    expect(callbacks).toBe(0)
    expect(ledger.stats.reservationsGranted).toBe(0)
    const capture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-constructor-input.json.gz", import.meta.url)))).toString()) as EvaluateRelaxedDrcInput
    const original = createMemoizedReferenceDrcEvaluator(), candidate = createMemoizedReferenceDrcEvaluator()
    const nativeInput = structuredClone(capture), candidateInput = structuredClone(capture)
    expect(candidate(candidateInput)).toEqual(original(nativeInput))
    expect(candidateInput).toEqual(nativeInput)
    expect(bindNativeReferenceDrcEvaluatorToPool(owner, candidate)).toBe(true)
    expect(candidate(candidateInput)).toEqual(original(nativeInput))
    expect(ledger.stats.batchesCompleted).toBe(0)
    // A new live trace geometry key must use the genuine worker/main lane facts.
    const changed = structuredClone(capture), expectedChanged = structuredClone(capture)
    const traces = changed.routedTraces.length ? changed.routedTraces : changed.inputSrj.traces!
    const expectedTraces = expectedChanged.routedTraces.length ? expectedChanged.routedTraces : expectedChanged.inputSrj.traces!
    const routeIndex = traces.findIndex((trace) => trace.route.some((point) => point.route_type === "wire"))
    const pointIndex = traces[routeIndex]!.route.findIndex((point) => point.route_type === "wire")
    ;(traces[routeIndex]!.route[pointIndex] as { x: number }).x += 0.01
    ;(expectedTraces[routeIndex]!.route[pointIndex] as { x: number }).x += 0.01
    expect(candidate(changed)).toEqual(original(expectedChanged))
    expect(changed).toEqual(expectedChanged)
    expect(ledger.stats.factRowsCompleted + ledger.stats.mainFactRowsCompleted).toBeGreaterThan(0)
    const batches = ledger.stats.batchesCompleted
    expect(bindNativeReferenceDrcEvaluatorToPool(owner, candidate)).toBe(true)
    expect(candidate(changed)).toEqual(original(expectedChanged))
    expect(ledger.stats.batchesCompleted).toBe(batches)
    expect(ledger.stats.workersReserved).toBe(ledger.stats.workersRetired)
    expect(ledger.stats.protocolFailures).toBe(0)
    expect(pool.stats.maxActiveWorkers).toBeLessThanOrEqual(4)
    expect(callbacks).toBe(0)
  } finally { await pool.dispose() }
})
