import * as Flatten from "@flatten-js/core"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import type { AnyCircuitElement } from "circuit-json"

type Memo = { diagnostics: unknown; identities: Map<unknown, unknown>; values: Map<unknown, unknown>; nextIdentity: number }
type Checker = (circuit: AnyCircuitElement[]) => unknown
const initialTolerance = Number(process.argv[2])
assert(Number.isFinite(initialTolerance))
// This precedes every autorouter import in this fresh main realm. Workers still
// load their own pinned Flatten copy at its original default numeric state.
Flatten.Utils.setTolerance(initialTolerance)
const repo = resolve(import.meta.dir, "../../..")
const base = join(repo, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel")
const fork = join(base, "authoritative-drc-fork")
const work = mkdtempSync(join(tmpdir(), "reference-tolerance-"))
symlinkSync(join(repo, "node_modules"), join(work, "node_modules"))
const sources = {
  checker: join(fork, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts"),
  index: join(fork, "native/lib/util/create-indexed-pcb-connectivity-map.ts"),
  via: join(fork, "native/lib/util/get-via-and-pour-connections.ts"),
  planner: join(fork, "referenceDrcPrimitiveMissPlanning.ts"),
  scope: join(fork, "referenceDrcNativeInternScope.ts"),
  trace: join(fork, "prepareReferenceDrcTracePairFacts.ts"),
  polygon: join(fork, "prepareReferenceDrcPolygonFacts.ts"),
}
const copies = Object.fromEntries(Object.keys(sources).map((key) => [key, join(work, `${key}.ts`)])) as Record<keyof typeof sources, string>
for (const kind of Object.keys(sources) as (keyof typeof sources)[]) {
  let source = readFileSync(sources[kind], "utf8")
  // Readonly evidence exports expose existing state; no native method wrappers,
  // admission bypass, executor substitutions or extra getter reads are used.
  if (kind === "checker") source = "export let latestPrivateMemo: unknown\nexport function getPolygonMemo(memo: any): any { return privatelyOwnedPolygonMemos.get(memo) }\n" + source.replaceAll("const primitiveMemo = new ReferenceDrcPrimitiveMemo()", "const primitiveMemo = new ReferenceDrcPrimitiveMemo()\n  latestPrivateMemo = primitiveMemo")
  if (kind === "index") source = "export let latestPhysicalMap: any\n" + source.replace("  return map\n", "  latestPhysicalMap = map\n  return map\n")
  source = source.replace(/from\s+"(\.[^"]+)"/g, (_match, spec: string): string => {
    let target = resolve(dirname(sources[kind]), spec)
    if (spec.includes("check-traces-are-contiguous/check-traces-are-contiguous")) target = copies.checker
    else if (spec.endsWith("create-indexed-pcb-connectivity-map")) target = copies.index
    else if (spec.endsWith("get-via-and-pour-connections")) target = copies.via
    else if (spec.endsWith("referenceDrcPrimitiveMissPlanning")) target = copies.planner
    else if (spec.endsWith("referenceDrcNativeInternScope")) target = copies.scope
    else if (spec.endsWith("prepareReferenceDrcTracePairFacts")) target = copies.trace
    else if (spec.endsWith("prepareReferenceDrcPolygonFacts")) target = copies.polygon
    return `from ${JSON.stringify(target)}`
  })
  writeFileSync(copies[kind], source)
}
const { Pipeline9LocalWorkerPool } = await import(join(base, "Pipeline9LocalWorkerPool.ts"))
const { createNativeSyncReferenceFactExecutor } = await import(join(base, "NativeSyncReferenceBatchTransport.ts"))
const { getDrcErrors } = await import(join(repo, "lib/testing/getDrcErrors.ts"))
const { checkViaTraceClearanceWithLazyCenters } = await import(join(fork, "checkViaTraceClearanceWithLazyCenters.ts"))
const { referenceDrcWorkerGeometryToleranceIsPinned, canUseExpectedPortsMemo } = await import(join(fork, "canUseExpectedPortsMemo.ts"))
const { captureReferenceDrcPolygonSnapshot, createReferenceDrcPolygonFactEvaluator } = await import(join(fork, "referenceDrcPolygonFacts.ts"))
const { createCopperPolygonContactTester } = await import(join(fork, "native/lib/copper-pour-connectivity/create-copper-polygon-contact-tester.ts"))
const { captureNativeSourceAliasProvenance } = await import(join(base, "nativeSourceAliasProvenance.ts"))
const checkerModule = await import(copies.checker), indexModule = await import(copies.index)
const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
await pool.initializeReferenceTransport()
await pool.warmup()
const executor = createNativeSyncReferenceFactExecutor(pool)
assert(executor !== undefined)
const native = checkerModule.createPrivatelyMemoizedTraceContinuityChecker() as Checker
const nativeMemo = checkerModule.latestPrivateMemo as Memo
const candidate = checkerModule.createPrivatelyMemoizedTraceContinuityChecker() as Checker
const candidateMemo = checkerModule.latestPrivateMemo as Memo
assert(checkerModule.configurePreparedPrivatelyMemoizedTraceContinuityChecker(candidate, executor))
const memoState = (memo: Memo): unknown => ({ diagnostics: memo.diagnostics, identities: [...memo.identities], values: [...memo.values], nextIdentity: memo.nextIdentity })
const polygonState = (memo: { diagnostics: unknown; retainedEdges: number; rows: Map<number, { edges: number; polygon?: Flatten.Polygon }> } | undefined): unknown => memo === undefined ? undefined : ({ diagnostics: memo.diagnostics, retainedEdges: memo.retainedEdges, rows: [...memo.rows].map(([id, row]) => [id, { edges: row.edges, polygon: row.polygon === undefined ? undefined : captureReferenceDrcPolygonSnapshot(row.polygon) }]) })
const circuit = (offset: number): AnyCircuitElement[] => ([
  ...[0, 1, 2, 3].map((i) => ({ type: "pcb_trace", pcb_trace_id: `trace${i}`, route: [{ route_type: "wire", x: -1 + offset, y: i * 0.01, width: 0.1, layer: "top" }, { route_type: "wire", x: 1 + offset, y: i * 0.01, width: 0.1, layer: "top" }] })),
  { type: "pcb_via", pcb_via_id: "via0", x: offset, y: 0, outer_diameter: 0.6, hole_diameter: 0.2, layers: ["top", "bottom"] },
  { type: "pcb_via", pcb_via_id: "via1", x: offset + 0.3, y: 0, outer_diameter: 0.6, hole_diameter: 0.2, layers: ["top", "bottom"] },
] as AnyCircuitElement[])
const phases: { tolerance: number; batches: number; facts: number; privateMemoEligible: boolean; nativeExceptions: number }[] = []
try {
  // Direct already-scaled Native contacts expose the pre-import numeric-state
  // issue independently of checker memoization. They are never dispatched.
  const diagonal = (2000 + 1) / Math.sqrt(2)
  const polygons = [new Flatten.Polygon(new Flatten.Circle(new Flatten.Point(0, 0), 1000)), new Flatten.Polygon(new Flatten.Circle(new Flatten.Point(diagonal, diagonal), 1000))]
  const nativeContact = createCopperPolygonContactTester(0.1)(polygons[0], polygons[1])
  assert.equal(nativeContact, initialTolerance === 10)
  const snapshots = polygons.map(captureReferenceDrcPolygonSnapshot)
  const geometrySnapshotSha256 = createHash("sha256").update(JSON.stringify(snapshots)).digest("hex")
  assert.equal(createReferenceDrcPolygonFactEvaluator(snapshots, 0.1)(0, 1), nativeContact)
  for (const [phase, tolerance] of [initialTolerance, 10, 1e-6].entries()) {
    Flatten.Utils.setTolerance(tolerance)
    const eligible = canUseExpectedPortsMemo(circuit(phase * 0.1))
    const before = pool.getNativeReferenceFactStats()!
    const options = { viaTraceChecker: (input: AnyCircuitElement[], options: unknown): ReturnType<typeof checkViaTraceClearanceWithLazyCenters> => checkViaTraceClearanceWithLazyCenters(input, { ...(options as object), enableAxisRejection: true, enableConnectivityMemo: true }) }
    let nativeExceptions = 0
    for (const includeVias of [false, true]) {
      const nativeInput = circuit(phase * 0.1).filter((element) => includeVias || element.type === "pcb_trace")
      const candidateInput = circuit(phase * 0.1).filter((element) => includeVias || element.type === "pcb_trace")
      let expected: unknown, output: unknown, nativeError: unknown, candidateError: unknown
      try { expected = getDrcErrors(nativeInput, { ...options, traceContinuityChecker: native }) } catch (error: unknown) { nativeError = error }
      const nativeMap = indexModule.latestPhysicalMap
      try { output = getDrcErrors(candidateInput, { ...options, traceContinuityChecker: candidate }) } catch (error: unknown) { candidateError = error }
      const candidateMap = indexModule.latestPhysicalMap
      assert.deepStrictEqual(candidateError, nativeError)
      if (nativeError !== undefined) { assert.equal(Object.getPrototypeOf(candidateError), Object.getPrototypeOf(nativeError)); nativeExceptions++ }
      else {
        assert.deepStrictEqual(output, expected)
        assert.deepStrictEqual(captureNativeSourceAliasProvenance(output, candidateInput), captureNativeSourceAliasProvenance(expected, nativeInput))
        assert.deepStrictEqual(candidateMap.connMap, nativeMap.connMap)
        for (const [id, trace] of candidateMap.traceIdToElm) assert.equal(trace, candidateInput.find((element) => element.type === "pcb_trace" && element.pcb_trace_id === id))
      }
      assert.deepStrictEqual(candidateInput, nativeInput)
      assert.deepStrictEqual(memoState(candidateMemo), memoState(nativeMemo))
      assert.deepStrictEqual(polygonState(checkerModule.getPolygonMemo(candidateMemo)), polygonState(checkerModule.getPolygonMemo(nativeMemo)))
    }
    const after = pool.getNativeReferenceFactStats()!
    const batches = after.batchesCompleted - before.batchesCompleted
    const facts = after.workerFactRowsCompleted + after.mainFactRowsCompleted - before.workerFactRowsCompleted - before.mainFactRowsCompleted
    if (referenceDrcWorkerGeometryToleranceIsPinned && tolerance === 1e-6) assert(batches > 0 && facts > 0)
    else { assert.equal(batches, 0); assert.equal(facts, 0); assert.equal(after.reservationsGranted, before.reservationsGranted) }
    phases.push({ tolerance, batches, facts, privateMemoEligible: eligible, nativeExceptions })
  }
  // An unsupported public getter must not be invoked by admission. Compare the
  // original Native continuation with the same observer-bearing runtime.
  let getterReads = 0
  const nativeFlattenDefault = (Flatten as unknown as { default: object }).default
  const descriptor = Object.getOwnPropertyDescriptor(nativeFlattenDefault, "Utils")!
  Object.defineProperty(nativeFlattenDefault, "Utils", { configurable: descriptor.configurable, enumerable: descriptor.enumerable, get(): never { getterReads++; throw new Error("extra tolerance namespace getter") } })
  try {
    const nativeInput = circuit(1).filter((element) => element.type === "pcb_trace"), candidateInput = circuit(1).filter((element) => element.type === "pcb_trace")
    const before = pool.getNativeReferenceFactStats()!
    assert.deepStrictEqual(candidate(candidateInput), native(nativeInput))
    assert.deepStrictEqual(memoState(candidateMemo), memoState(nativeMemo))
    assert.equal(getterReads, 0)
    assert.equal(pool.getNativeReferenceFactStats()!.batchesCompleted, before.batchesCompleted)
  } finally { Object.defineProperty(nativeFlattenDefault, "Utils", descriptor) }
  const stats = pool.getNativeReferenceFactStats()!
  assert.equal(stats.workersReserved, stats.workersRetired)
  assert.equal(stats.protocolFaults, 0)
  assert(pool.stats.maxActiveWorkers <= 4)
  process.stdout.write(JSON.stringify({ initialTolerance, nativeContact, geometrySnapshotSha256, capturedPinned: referenceDrcWorkerGeometryToleranceIsPinned, phases, getterReads, stats }) + "\n")
} finally { pool.dispose() }
