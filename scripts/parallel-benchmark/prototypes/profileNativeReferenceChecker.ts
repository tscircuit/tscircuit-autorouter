import { profile, type SamplingProfile, type SamplingProfileStackFrame } from "bun:jsc"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readdir, readFile } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import type { AnyCircuitElement } from "circuit-json"

type Capture = { number: number; circuitJson: AnyCircuitElement[]; options: Record<string, unknown>; expected: unknown }
type FrameCount = { name: string; source: string; line: number; category: string; self: number; inclusive: number }
type RecordSummary = { number: number; mainFactRows: number; workerFactRows: number; batches: number }
const sourceRoot = process.env.REFERENCE_PROFILE_ROOT
const expectedRevision = process.env.REFERENCE_PROFILE_SHA
if (!sourceRoot || !expectedRevision) throw new Error("REFERENCE_PROFILE_ROOT and REFERENCE_PROFILE_SHA must identify an immutable source worktree")
const revisionResult = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: sourceRoot, stdout: "pipe", stderr: "pipe" })
assert.equal(revisionResult.exitCode, 0)
const revision = new TextDecoder().decode(revisionResult.stdout).trim()
assert.equal(revision, expectedRevision)
const directory = resolve(process.env.REFERENCE_PROFILE_OUTPUT ?? "/tmp/native-reference-main-profile")
await mkdir(directory, { recursive: true })
const parallel = join(sourceRoot, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel")
const fork = join(parallel, "authoritative-drc-fork")
const capturePath = join(sourceRoot, "tests/fixtures/reference-drc-srj18/sample015-native-reference.json.gz")
const captureBytes = new Uint8Array(await readFile(capturePath))
const captures = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(captureBytes))) as { records: Capture[] }
assert.equal(captures.records.length, 17)
const { Pipeline9LocalWorkerPool } = await import(join(parallel, "Pipeline9LocalWorkerPool.ts"))
const { createNativeSyncReferenceFactExecutor } = await import(join(parallel, "NativeSyncReferenceBatchTransport.ts"))
const { createPrivatelyMemoizedTraceContinuityChecker, configurePreparedPrivatelyMemoizedTraceContinuityChecker } = await import(join(fork, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts"))
const { checkViaTraceClearanceWithLazyCenters } = await import(join(fork, "checkViaTraceClearanceWithLazyCenters.ts"))
const { captureNativeSourceAliasProvenance } = await import(join(parallel, "nativeSourceAliasProvenance.ts"))
const { getDrcErrors } = await import(join(sourceRoot, "lib/testing/getDrcErrors.ts"))
const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
await pool.initializeReferenceTransport()
await pool.warmup()
const nativeChecker = createPrivatelyMemoizedTraceContinuityChecker()
const candidateChecker = createPrivatelyMemoizedTraceContinuityChecker()
const executor = createNativeSyncReferenceFactExecutor(pool)
assert(executor !== undefined)
assert(configurePreparedPrivatelyMemoizedTraceContinuityChecker(candidateChecker, executor))
const records: RecordSummary[] = []
try {
  const nativeInputs = captures.records.map((capture) => structuredClone(capture.circuitJson))
  const candidateInputs = captures.records.map((capture) => structuredClone(capture.circuitJson))
  const optionsByRecord = captures.records.map((capture) => ({ ...capture.options,
      viaTraceChecker: (input: AnyCircuitElement[], viaOptions: object): ReturnType<typeof checkViaTraceClearanceWithLazyCenters> => checkViaTraceClearanceWithLazyCenters(input, { ...viaOptions, enableAxisRejection: true, enableConnectivityMemo: true }) }
    ))
  // One span avoids the pinned Bun JSC profiler's ineffective restart after its
  // first stop. Controls, cloning, assertions and exports stay outside the span.
  const expected = captures.records.map((_capture, index) => getDrcErrors(nativeInputs[index]!, { ...optionsByRecord[index], traceContinuityChecker: nativeChecker }))
  const actual: unknown[] = []
  const report = profile((): void => {
    for (let index = 0; index < captures.records.length; index++) {
      const before = pool.getNativeReferenceFactStats()!
      actual.push(getDrcErrors(candidateInputs[index]!, { ...optionsByRecord[index], traceContinuityChecker: candidateChecker }))
      const after = pool.getNativeReferenceFactStats()!
      records.push({ number: captures.records[index]!.number,
      mainFactRows: after.mainFactRowsCompleted - before.mainFactRowsCompleted,
      workerFactRows: after.workerFactRowsCompleted - before.workerFactRowsCompleted,
      batches: after.batchesCompleted - before.batchesCompleted })
    }
  }, 1000)
  for (let index = 0; index < captures.records.length; index++) {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(expected[index])), captures.records[index]!.expected)
    assert.deepStrictEqual(actual[index], expected[index])
    assert.deepStrictEqual(candidateInputs[index], nativeInputs[index])
    assert.deepStrictEqual(captureNativeSourceAliasProvenance(actual[index], candidateInputs[index]), captureNativeSourceAliasProvenance(expected[index], nativeInputs[index]))
  }
  const local = summarize(report, sourceRoot)
  const samples = local.counts.stackSamples, continuitySamples = local.counts.continuitySamples, blockedTransportSamples = local.counts.blockedTransportSamples
  await Bun.write(join(directory, "all17.functions.txt"), report.functions)
  await Bun.write(join(directory, "all17.bytecodes.txt"), report.bytecodes)
  const stats = pool.getNativeReferenceFactStats()!
  assert.equal(stats.batchesCompleted, 26)
  assert.equal(stats.mainFactRowsCompleted + stats.workerFactRowsCompleted, 28116)
  assert.equal(stats.workersReserved, 78)
  assert.equal(stats.workersRetired, 78)
  assert.equal(stats.maxFactWorkerLanes, 3)
  assert.equal(stats.mainFactLaneCount, 1)
  assert(pool.stats.maxActiveWorkers <= 4)
  const hashes: Record<string, string> = {}
  for (const path of await sourceFiles(fork)) hashes[relative(sourceRoot, path)] = createHash("sha256").update(new Uint8Array(await readFile(path))).digest("hex")
  for (const path of ["NativeSyncReferenceBatchTransport.ts", "nativeSyncReferenceProtocol.ts", "parallelReferenceContinuityKernel.ts", "parallelReferenceContinuityTypes.ts", "Pipeline9LocalWorkerPool.ts", "pipeline9LocalWorker.ts"]) {
    hashes[relative(sourceRoot, join(parallel, path))] = createHash("sha256").update(new Uint8Array(await readFile(join(parallel, path)))).digest("hex")
  }
  const raw = Bun.gzipSync(new TextEncoder().encode(JSON.stringify([report])))
  await Bun.write(join(directory, "raw-jsc-profiles.json.gz"), raw)
  const summary = {
    kind: "Bun JavaScriptCore actual synchronous Native reference checker attribution",
    sourceRevision: revision, sourceRoot, bunVersion: Bun.version, sampleIntervalMicroseconds: 1000,
    captureSha256: createHash("sha256").update(captureBytes).digest("hex"),
    profilerScriptSha256: createHash("sha256").update(new Uint8Array(await readFile(import.meta.path))).digest("hex"),
    rawProfileSha256: createHash("sha256").update(raw).digest("hex"), sourceHashes: hashes,
    wholeNativeErrorsExact: true, postCircuitJsonExact: true, errorSourceAliasesExact: true,
    nativeMethodsWrapped: false, originalPrivateCheckerMemoReusedAcrossAll17: true,
    noLocalElapsedComparison: true, noSpeedClaim: true,
    limitation: "One profile span encloses the seventeen original sync evaluations, plus their closed scheduling loop and readonly fact-stat snapshots; controls/clones/assertions are excluded. Sampling attribution can include host transport waits; samples are not exclusive CPU work or Blacksmith wall performance. Explicit Atomics.wait frames are reported separately. Source IDs resolve through the raw source table. Inlined and anonymous frames remain in raw evidence.",
    samples, continuitySamples, blockedTransportSamples, factStats: stats,
    hotspots: local.hotspots, records,
  }
  await Bun.write(join(directory, "summary.json"), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify({ sourceRevision: revision, samples, continuitySamples, blockedTransportSamples, factStats: stats, hotspots: summary.hotspots.slice(0, 25), directory }, null, 2))
} finally { pool.dispose() }

function summarize(report: SamplingProfile, root: string): { counts: { stackSamples: number; continuitySamples: number; blockedTransportSamples: number }; hotspots: FrameCount[] } {
  const counters = new Map<string, FrameCount>()
  const sources = new Map(report.stackTraces.sources.map((source) => [source.sourceID, source.sourceURL ?? source.url]))
  let continuity = 0, blocked = 0
  for (const trace of report.stackTraces.traces) {
    const seen = new Set<string>()
    let hasContinuity = false, hasWait = false
    for (let index = 0; index < trace.frames.length; index++) {
      const frame: SamplingProfileStackFrame = trace.frames[index]!
      const path = frame.sourceURL ?? sources.get(frame.sourceID)
      const source = path === undefined ? `[native:${frame.sourceID}]` : path.startsWith(root) ? relative(root, path) : path
      const key = JSON.stringify([frame.name, source, frame.line, frame.category])
      let row = counters.get(key)
      if (row === undefined) { row = { name: frame.name, source, line: frame.line, category: frame.category, self: 0, inclusive: 0 }; counters.set(key, row) }
      if (index === 0) row.self++
      if (!seen.has(key)) { row.inclusive++; seen.add(key) }
      if (frame.name === "checkTracesAreContiguous") hasContinuity = true
      if (frame.name === "wait" && source.startsWith("[native:")) hasWait = true
    }
    if (hasContinuity) continuity++
    if (hasWait) blocked++
  }
  return { counts: { stackSamples: report.stackTraces.traces.length, continuitySamples: continuity, blockedTransportSamples: blocked }, hotspots: [...counters.values()].sort((a, b) => b.inclusive - a.inclusive || b.self - a.self) }
}

async function sourceFiles(directory: string): Promise<string[]> {
  const output: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) output.push(...await sourceFiles(path))
    else if (entry.name.endsWith(".ts")) output.push(path)
  }
  return output.sort()
}
