import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { gunzipSync } from "node:zlib"
import { execFileSync } from "node:child_process"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { ReferenceDrcPrimitiveMemo } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { executeParallelReferenceContinuityBatch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityKernel"
import { checkViaTraceClearanceWithLazyCenters } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import type { ParallelReferenceContinuityBatch } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/parallelReferenceContinuityTypes"
import { getDrcErrors } from "../../lib/testing/getDrcErrors"

test("prepared private trace misses preserve native consumed caches, errors, graph mutations and observer admission", async () => {
  await initializeReferenceDrcRuntime()
  const repo = resolve(import.meta.dir, "../.."), work = mkdtempSync(join(tmpdir(), "reference-prepared-consumption-"))
  symlinkSync(join(repo, "node_modules"), join(work, "node_modules"))
  const base = join(repo, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork")
  const sources = {
    checker: join(base, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts"),
    index: join(base, "native/lib/util/create-indexed-pcb-connectivity-map.ts"),
    planner: join(base, "referenceDrcPrimitiveMissPlanning.ts"),
    prepare: join(base, "prepareReferenceDrcTracePairFacts.ts"),
  }
  const copies = { checker: join(work, "checker.ts"), index: join(work, "index.ts"), planner: join(work, "planner.ts"), prepare: join(work, "prepare.ts") }
  for (const kind of Object.keys(sources) as (keyof typeof sources)[]) {
    let source = readFileSync(sources[kind], "utf8")
    if (kind === "checker") source = "export let latestPrivateMemo: unknown\n" + source.replaceAll("const primitiveMemo = new ReferenceDrcPrimitiveMemo()", "const primitiveMemo = new ReferenceDrcPrimitiveMemo()\n  latestPrivateMemo = primitiveMemo")
    // This controlled source-copy oracle admits its fixed synchronous test
    // executor. Production checks the private Native transport WeakSet brand.
    if (kind === "prepare") {
      expect(source.includes("!isNativeSyncReferenceFactExecutor(executor)")).toBe(true)
      source = source.replace("!isNativeSyncReferenceFactExecutor(executor)", "false")
      expect(source.includes("!canAdmitNativeSyncReferenceFacts(executor)")).toBe(true)
      source = source.replace("!canAdmitNativeSyncReferenceFacts(executor)", "false")
    }
    source = source.replace(/from\s+"(\.[^"]+)"/g, (_match, spec: string) => {
      let target = resolve(dirname(sources[kind]), spec)
      if (spec.includes("check-traces-are-contiguous/check-traces-are-contiguous")) target = copies.checker
      else if (spec.endsWith("create-indexed-pcb-connectivity-map")) target = copies.index
      else if (spec.endsWith("referenceDrcPrimitiveMissPlanning")) target = copies.planner
      else if (spec.endsWith("prepareReferenceDrcTracePairFacts")) target = copies.prepare
      return `from ${JSON.stringify(target)}`
    })
    writeFileSync(copies[kind], source)
  }
  const checker = await import(copies.checker)
  const productionChecker = await import(sources.checker)
  const state = (memo: ReferenceDrcPrimitiveMemo): unknown => ({ diagnostics: { ...memo.diagnostics }, values: [...(memo as any).values], identities: [...(memo as any).identities], nextIdentity: (memo as any).nextIdentity })
  const native = checker.createPrivatelyMemoizedTraceContinuityChecker()
  const nativeMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  let originalCircuit: any[] = [], batches = 0, rows = 0
  const prepared = checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch: ParallelReferenceContinuityBatch) => {
    batches++; rows += batch.tasks.length
    for (const trace of batch.context.geometryTraces!) {
      const original = originalCircuit.find((element) => element.type === "pcb_trace" && element.pcb_trace_id === trace.pcb_trace_id)
      expect(trace).not.toBe(original)
      expect(trace.route).not.toBe(original.route)
    }
    return executeParallelReferenceContinuityBatch(batch)
  })
  const preparedMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  const captures = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("../fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url)))).toString()) as { records: any[] }
  const visitsPerRecord: number[] = []
  for (const capture of captures.records) {
    const nativeInput = structuredClone(capture.circuitJson)
    originalCircuit = structuredClone(capture.circuitJson)
    const options = { ...capture.options, viaTraceChecker: (circuit: any, viaOptions: any) => checkViaTraceClearanceWithLazyCenters(circuit, { ...viaOptions, enableAxisRejection: true, enableConnectivityMemo: true }) }
    const nativeOutput = getDrcErrors(nativeInput, { ...options, traceContinuityChecker: native })
    const before = rows
    const preparedOutput = getDrcErrors(originalCircuit, { ...options, traceContinuityChecker: prepared })
    expect(JSON.parse(JSON.stringify(nativeOutput))).toEqual(capture.expected)
    expect(preparedOutput).toEqual(nativeOutput)
    expect(originalCircuit).toEqual(nativeInput)
    expect(state(preparedMemo)).toEqual(state(nativeMemo))
    visitsPerRecord.push(rows - before)
  }
  expect(batches).toBe(13); expect(rows).toBe(12215)
  expect(visitsPerRecord).toEqual([0,2166,1922,1923,1509,427,1384,63,8,1231,0,709,168,0,694,0,11])
  const simple = (): any[] => [0,1,2].map((i) => ({ type: "pcb_trace", pcb_trace_id: `trace${i}`, route: [
    { route_type: "wire", x: -1, y: i * 0.01, width: 0.1, layer: "top" },
    { route_type: "wire", x: 1, y: i * 0.01, width: 0.1, layer: "top" },
  ] }))
  let declineCalls = 0
  const declined = checker.createPreparedPrivatelyMemoizedTraceContinuityChecker(() => { declineCalls++; return undefined })
  const declinedMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  const ordinary = checker.createPrivatelyMemoizedTraceContinuityChecker()
  const ordinaryMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  expect(declined(simple())).toEqual(ordinary(simple()))
  expect(state(declinedMemo)).toEqual(state(ordinaryMemo)); expect(declineCalls).toBe(1)
  expect(declined(simple())).toEqual(ordinary(simple()))
  expect(state(declinedMemo)).toEqual(state(ordinaryMemo)); expect(declineCalls).toBe(1)
  let unownedCalls = 0
  checker.checkTracesAreContiguous(simple(), { primitiveMemo: new ReferenceDrcPrimitiveMemo(), preparedFactExecutor: () => { unownedCalls++; throw new Error("unowned executor") } })
  expect(unownedCalls).toBe(0)
  const unbranded = productionChecker.createPreparedPrivatelyMemoizedTraceContinuityChecker(() => { unownedCalls++; throw new Error("unbranded executor") })
  expect(unbranded(simple())).toEqual(productionChecker.createPrivatelyMemoizedTraceContinuityChecker()(simple()))
  expect(unownedCalls).toBe(0)
  for (const hiddenField of ["width", "x", "route", "pcb_trace_id", "route_type"] as const) {
    const hidden = (): any[] => {
      const circuit = simple()
      for (let i = 0; i < circuit.length; i++) {
        for (const point of circuit[i].route) { point.width = 0.2; point.y = i * 0.1 }
      }
      const target = hiddenField === "route" || hiddenField === "pcb_trace_id" ? circuit[0] : circuit[0].route[0]
      Object.defineProperty(target, hiddenField, { ...Object.getOwnPropertyDescriptor(target, hiddenField)!, enumerable: false })
      return circuit
    }
    const hiddenNative = checker.createPrivatelyMemoizedTraceContinuityChecker()
    const hiddenNativeMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
    let hiddenCalls = 0
    const hiddenPrepared = checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch: ParallelReferenceContinuityBatch) => {
      hiddenCalls++
      expect(batch.context.geometryTraces![0]!.route[0]).toMatchObject({ route_type: "wire", x: -1, y: 0, width: 0.2 })
      return executeParallelReferenceContinuityBatch(batch)
    })
    const hiddenPreparedMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
    const nativeInput = hidden(), candidateInput = hidden()
    expect(hiddenPrepared(candidateInput)).toEqual(hiddenNative(nativeInput))
    expect(state(hiddenPreparedMemo)).toEqual(state(hiddenNativeMemo))
    expect(candidateInput).toEqual(nativeInput); expect(hiddenCalls).toBe(1)
  }
  const aliases = (): any[] => {
    const circuit = simple()
    circuit[1].route = circuit[0].route
    circuit[2].route[0] = circuit[0].route[0]
    circuit[0].route[0].x = -0
    circuit[0].route[1].x = 0.5
    return circuit
  }
  const aliasNative = checker.createPrivatelyMemoizedTraceContinuityChecker()
  const aliasNativeMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  let aliasCalls = 0
  const aliasPrepared = checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch: ParallelReferenceContinuityBatch) => {
    aliasCalls++
    const traces = batch.context.geometryTraces!
    expect(traces[0]!.route).toBe(traces[1]!.route)
    expect(traces[0]!.route[0]).toBe(traces[2]!.route[0])
    expect(Object.is((traces[0]!.route[0]! as { x: number }).x, -0)).toBe(true)
    return executeParallelReferenceContinuityBatch(batch)
  })
  const aliasMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  const aliasInput = aliases(), nativeAliasInput = aliases()
  expect(aliasPrepared(aliasInput)).toEqual(aliasNative(nativeAliasInput)); expect(state(aliasMemo)).toEqual(state(aliasNativeMemo))
  expect(aliasInput[0].route).toBe(aliasInput[1].route); expect(aliasInput[0].route[0]).toBe(aliasInput[2].route[0]); expect(aliasCalls).toBe(1)
  const malformed = checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch: ParallelReferenceContinuityBatch) => {
    const result = executeParallelReferenceContinuityBatch(batch)
    const last = result.facts[result.facts.length - 1]!
    Object.defineProperty(last, "value", { get() { throw new Error("malformed value getter executed") } })
    return result
  })
  const malformedMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  expect(() => malformed(simple())).toThrow("own data reference field value")
  expect(malformedMemo.diagnostics).toEqual({ hits: 0, misses: 0 })
  const falseException = checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch: ParallelReferenceContinuityBatch) => ({ kind: "referenceContinuityFacts", snapshotId: batch.context.snapshotId, facts: batch.tasks.map((task) => ({ status: "exception", kind: "native-trace-pair-miss", rowIndex: task.rowIndex, consumedVisits: 1, exception: { name: "TypeError", message: "unused" } })) }))
  expect(() => falseException(simple())).toThrow("predicate exception did not reproduce")
  const falseExceptionMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  expect(falseExceptionMemo.diagnostics).toEqual({ hits: 0, misses: 1 })
  const prepareModule = await import(copies.prepare)
  checker.createPrivatelyMemoizedTraceContinuityChecker()
  const reconsumedMemo = checker.latestPrivateMemo as ReferenceDrcPrimitiveMemo
  const reconsumedTraces = simple(), reconsumedIds = reconsumedTraces.map((trace) => reconsumedMemo.intern(trace))
  const reconsumed = prepareModule.prepareReferenceDrcTracePairFacts(reconsumedMemo, reconsumedTraces, reconsumedIds, [new Set([1,2]), new Set([2]), new Set()], (batch: ParallelReferenceContinuityBatch) => ({ kind: "referenceContinuityFacts", snapshotId: batch.context.snapshotId, facts: batch.tasks.map((task) => ({ status: "exception", kind: "native-trace-pair-miss", rowIndex: task.rowIndex, consumedVisits: 1, exception: { name: "TypeError", message: "worker-only metadata" } })) }))!
  const originalFailure = new RangeError("original ordered main predicate sentinel")
  let consumedFailure: unknown, nativeFailureCalls = 0
  try { reconsumed.consume(0, 1, () => { nativeFailureCalls++; throw originalFailure }) }
  catch (error: unknown) { consumedFailure = error }
  expect(consumedFailure).toBe(originalFailure); expect(nativeFailureCalls).toBe(1)
  expect(reconsumedMemo.diagnostics).toEqual({ hits: 0, misses: 1 })
  expect([...(reconsumedMemo as any).values]).toEqual([])
  let executions = 0
  const noObservers = checker.createPreparedPrivatelyMemoizedTraceContinuityChecker(() => { executions++; throw new Error("observer domain executed") })
  let cloneIndependentCalls = 0
  const cloneIndependent = checker.createPreparedPrivatelyMemoizedTraceContinuityChecker((batch: ParallelReferenceContinuityBatch) => { cloneIndependentCalls++; return executeParallelReferenceContinuityBatch(batch) })
  const cloneDescriptor = Object.getOwnPropertyDescriptor(globalThis, "structuredClone")!
  let cloneReads = 0
  Object.defineProperty(globalThis, "structuredClone", { configurable: true, get() { cloneReads++; return cloneDescriptor.value } })
  try { expect(cloneIndependent(simple())).toEqual(checker.createPrivatelyMemoizedTraceContinuityChecker()(simple())) }
  finally { Object.defineProperty(globalThis, "structuredClone", cloneDescriptor) }
  expect(cloneReads).toBe(0); expect(cloneIndependentCalls).toBe(1); expect(executions).toBe(0)
  const nativePairDescriptor = Object.getOwnPropertyDescriptor(PcbConnectivityMap.prototype, "_arePcbTracesConnected")!
  const sentinel = new RangeError("original Native predicate failure")
  Object.defineProperty(PcbConnectivityMap.prototype, "_arePcbTracesConnected", { ...nativePairDescriptor, value: () => { throw sentinel } })
  let thrown: unknown
  try { noObservers(simple()) } catch (error) { thrown = error }
  finally { Object.defineProperty(PcbConnectivityMap.prototype, "_arePcbTracesConnected", nativePairDescriptor) }
  expect(thrown).toBe(sentinel); expect(executions).toBe(0)
  const observed = (counts: { reads: number }): any[] => {
    const circuit = simple()
    Object.defineProperty(circuit[0].route[0], "x", { enumerable: true, configurable: true, get() { counts.reads++; return -1 } })
    return circuit
  }
  const nativeCounts = { reads: 0 }, preparedCounts = { reads: 0 }
  const nativeObserved = checker.createPrivatelyMemoizedTraceContinuityChecker()(observed(nativeCounts))
  const preparedObserved = noObservers(observed(preparedCounts))
  expect(preparedObserved).toEqual(nativeObserved); expect(preparedCounts.reads).toBe(nativeCounts.reads); expect(executions).toBe(0)
  const importWithoutClone = `delete globalThis.structuredClone; const module = await import(${JSON.stringify(sources.checker)}); module.createPrivatelyMemoizedTraceContinuityChecker()(${JSON.stringify(simple())}); console.log("native-import-ok")`
  expect(execFileSync(process.execPath, ["-e", importWithoutClone], { cwd: repo, encoding: "utf8" }).trim()).toBe("native-import-ok")
})
