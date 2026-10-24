import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, chmodSync } from "node:fs"
import { resolve } from "node:path"
import {
  assertOwnerCutFrozenReference, assertOwnerCutHistoricalIdentity, compareOwnerCutResults, ownerCutQueryFingerprint, ownerCutReferenceDifferences, ownerCutValueHash, storeOwnerCutResult,
  runColdOwnerCutOperator, type OwnerCutBenchmarkArm, type OwnerCutBenchmarkHost,
  type OwnerCutBenchmarkReference, type OwnerCutBenchmarkResult, type OwnerCutFrozenQuery, type OwnerCutStoredResult,
} from "./ownerCutBenchmarkModel"
import { getBenchmarkRuntimeMetadata } from "./benchmarkRuntime"

const kernelCommit = "2a8d1811cc29cbb700c11fe4eeb231b03cd04a15"
const pinnedSources: Record<string, string> = {
  "lib/solvers/PortPointPathingSolver/tinyhypergraph/findCutGuidedOwnerRelease.ts": "e08296617817d9e88b2582720e0045f69e448cbe62d254e6878f086522bd010b",
  "lib/solvers/PortPointPathingSolver/tinyhypergraph/buildOwnerCutCondensation.ts": "3d96dc6537e0d7ed4e36982b9fc38b24df46b3e055fea8ae0b8ced9ec509bd38",
  "node_modules/tiny-hypergraph/lib/find-distinct-owner-blocker-path.ts": "6cbc4cb2622a7e547f3c1c16dca37bd4aabdf5ff1bdade575b9a346f34119918",
  "node_modules/tiny-hypergraph/lib/selective-rerip-tiny-hyper-graph-solver.ts": "4fd8a379aebbd49b42271fd560e8f3081056a5cb7e2065eadb9318cbdd5c0f5f",
}
const referencePath = resolve(import.meta.dir, "owner-cut-real-query-reference.json")
const maxCandidateWork = 300_000_000
const passTimeoutMs = 60 * 60 * 1000
const order: OwnerCutBenchmarkArm[] = ["native", "candidate", "candidate", "native"]
type QueryRow = {
  sample: number; queryIndex: number; routeId: number; fingerprint: string
  status: "operator-started" | "control-started" | "complete"; nativeResultHash?: string
  [key: string]: unknown
}
type PassReport = {
  schema: number; arm: OwnerCutBenchmarkArm; status: "running" | "complete" | "failed"
  provenance: ReturnType<typeof getProvenance>; runtime: ReturnType<typeof assertRuntime>
  candidateWorkCap: number; platformReferenceHash: string; preflightProcessId: number
  rows: QueryRow[]; controlQueries: NativeQueryRecord[]; continuations: Continuation[]; error?: string
}
export type OwnerCutChildRecord = {
  index: number; arm: OwnerCutBenchmarkArm; exitStatus: number | null
  signal: string | null; error?: string; logHash: string; reportHash?: string
}

function hashFile(path: string): string {
  const bytes = readFileSync(path)
  return createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex")
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`)
  return result.stdout.trim()
}

function getProvenance(): {
  sha: string; tree: string; libraryTree: string; kernelCommit: string
  sourceHashes: Record<string, string>; packageHash: string; lockHash: string
  referenceHash: string; driverHash: string; modelHash: string
} {
  const sourceHashes = Object.fromEntries(Object.entries(pinnedSources).map(([path, expected]): [string, string] => {
    const actual = hashFile(path)
    if (actual !== expected) throw new Error(`Frozen operator source changed: ${path}`)
    return [path, actual]
  }))
  const sha = capture("git", ["rev-parse", "HEAD"])
  if (sha !== process.env.OWNER_CUT_SOURCE_SHA) throw new Error("OWNER_CUT_SOURCE_SHA must pin this exact checkout")
  if (capture("git", ["status", "--porcelain", "--untracked-files=no"]) !== "") throw new Error("Tracked benchmark checkout must be clean")
  if (!existsSync("bun.lock")) throw new Error("A preserved resolved bun.lock is required before measurement")
  return { sha, tree: capture("git", ["rev-parse", "HEAD^{tree}"]), libraryTree: capture("git", ["rev-parse", "HEAD:lib"]),
    kernelCommit, sourceHashes, packageHash: hashFile("package.json"), lockHash: hashFile("bun.lock"),
    referenceHash: hashFile(referencePath), driverHash: hashFile(import.meta.path), modelHash: hashFile(resolve(import.meta.dir, "ownerCutBenchmarkModel.ts")) }
}

function assertRuntime(): ReturnType<typeof getBenchmarkRuntimeMetadata> & { routingThreads: number; processId: number } {
  const runtime = getBenchmarkRuntimeMetadata(1, 1)
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.OWNER_CUT_BENCHMARK_APPROVED !== "1" ||
    runtime.bunVersion !== "1.4.2" || runtime.platform !== "linux" || runtime.architecture !== "arm64" ||
    runtime.availableParallelism !== 8 || runtime.logicalCpuCount !== 8 || typeof Bun.gc !== "function") {
    throw new Error("Operator timing requires explicitly approved Blacksmith Linux ARM64/8CPU/Bun1.4.2; local timing is prohibited")
  }
  return { ...runtime, routingThreads: 1, processId: process.pid }
}

function resultSummary(result: OwnerCutBenchmarkResult): Record<string, unknown> {
  return result.found ? { found: true, owners: [...result.owners], distance: result.distance,
    stateCount: result.states.length, resultHash: ownerCutValueHash(result), expandedLabelCount: result.expandedLabelCount }
    : { found: false, reason: result.reason, expandedLabelCount: result.expandedLabelCount }
}

type NativeQueryRecord = {
  sample: number; index: number; routeId: number; fingerprint: string
  nativeResultHash: string; witness: OwnerCutStoredResult
  historicalDifferences?: ReturnType<typeof ownerCutReferenceDifferences>
}
type Continuation = {
  sample: number; scenarioHash: string; nativeQueryCount: number; nativeExpandedTotal: number
  portSolved: boolean; portIterations: number; portOutputHash: string
}
type PlatformSample = {
  sample: number; queries: OwnerCutFrozenQuery[]; allNativeQueries: NativeQueryRecord[]
  continuation?: Continuation
}
type PlatformReferenceReport = {
  schema: number; status: "running" | "complete" | "failed"
  provenance: ReturnType<typeof getProvenance>; runtime: ReturnType<typeof assertRuntime>
  historicalReferenceHash: string; samples: PlatformSample[]; error?: string
}
type QueryVisitor = (
  host: OwnerCutBenchmarkHost, forbidden: ReadonlySet<number>, callNative: () => OwnerCutBenchmarkResult,
  index: number,
) => OwnerCutBenchmarkResult

function readHistoricalReference(): OwnerCutBenchmarkReference {
  const reference = JSON.parse(readFileSync(referencePath, "utf8")) as OwnerCutBenchmarkReference
  if (reference.schema !== 1 || reference.base !== "b9d32a05c76af701d518f6a78a3114e68addd144" || reference.kernelCommit !== kernelCommit ||
    reference.samples.length !== 2 || reference.samples[0]?.sample !== 6 || reference.samples[0].queries.length !== 7 ||
    reference.samples[0].expectedTotalNativeQueries !== 7 || reference.samples[1]?.sample !== 14 || reference.samples[1].queries.length !== 12 ||
    reference.samples[1].expectedTotalNativeQueries !== 35 ||
    reference.samples.some((sample) => sample.queries.some((query, index) => query.index !== index + 1))) {
    throw new Error("Expected immutable 19-query selection and 7/35 native continuation populations")
  }
  return reference
}

/** Every continuation is driven exclusively by an original native result. */
async function replayNativeSample(sample: number, visit: QueryVisitor): Promise<Continuation> {
  const { TinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver } = await import("tiny-hypergraph/lib/index")
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import("../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph")
  const { loadScenarioBySampleNumber } = await import("./scenarios")
  const { scenario } = await loadScenarioBySampleNumber("srj18", sample)
  const scenarioHash = ownerCutValueHash(scenario)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  const installed = new WeakSet<object>()
  let queryCount = 0, expandedTotal = 0
  const install = (solver: InstanceType<typeof TinyHyperGraphSolver>): void => {
    if (installed.has(solver)) return
    installed.add(solver)
    const instance = solver as unknown as OwnerCutBenchmarkHost & {
      findRelaxedBlockerPath(forbidden?: ReadonlySet<number>): OwnerCutBenchmarkResult
      createGreedyFinalRouteSolver(...args: unknown[]): InstanceType<typeof TinyHyperGraphSolver>
    }
    const factory = instance.createGreedyFinalRouteSolver
    instance.createGreedyFinalRouteSolver = (...args): InstanceType<typeof TinyHyperGraphSolver> => {
      const child = factory.apply(solver, args); install(child); return child
    }
    if (!(solver instanceof SelectiveReripTinyHyperGraphSolver)) return
    const original = instance.findRelaxedBlockerPath
    instance.findRelaxedBlockerPath = (forbidden = new Set<number>()): OwnerCutBenchmarkResult => {
      const native = visit(instance, forbidden, (): OwnerCutBenchmarkResult => original.call(solver, forbidden), ++queryCount)
      expandedTotal += native.expandedLabelCount
      return native
    }
  }
  while (!pipeline.solved && !pipeline.failed) {
    if (pipeline.pipelineDef[pipeline.currentPipelineStepIndex]?.solverName === "uniformPortDistributionSolver") break
    const stage = pipeline.portPointPathingSolver
    const inner = stage as unknown as { tinyPipelineSolver?: { activeSubSolver?: object; getSolver?(name: string): object | undefined } } | undefined
    for (const value of [stage?.activeSubSolver, inner?.tinyPipelineSolver?.activeSubSolver, inner?.tinyPipelineSolver?.getSolver?.("solveGraph")]) {
      if (value instanceof TinyHyperGraphSolver) install(value)
    }
    pipeline.step()
  }
  const port = pipeline.portPointPathingSolver
  if (!port?.solved || pipeline.failed) throw new Error(`Native sample ${sample} port continuation failed`)
  return { sample, scenarioHash, nativeQueryCount: queryCount, nativeExpandedTotal: expandedTotal,
    portSolved: port.solved, portIterations: port.iterations, portOutputHash: ownerCutValueHash(port.getOutput()) }
}

async function runPreflight(directory: string): Promise<void> {
  const runtime = assertRuntime(), provenance = getProvenance(), historical = readHistoricalReference()
  mkdirSync(directory, { recursive: true })
  const report: PlatformReferenceReport = { schema: 1, status: "running", provenance, runtime,
    historicalReferenceHash: provenance.referenceHash, samples: [] }
  const save = (): void => writeFileSync(resolve(directory, "platform-reference.json"), JSON.stringify(report, null, 2) + "\n")
  save()
  try {
    for (const reference of historical.samples) {
      const sample: PlatformSample = { sample: reference.sample, queries: [], allNativeQueries: [] }
      report.samples.push(sample); save()
      sample.continuation = await replayNativeSample(reference.sample, (host, forbidden, callNative, index): OwnerCutBenchmarkResult => {
        const fingerprint = ownerCutQueryFingerprint(host, forbidden)
        const native = callNative(), expected = reference.queries[index - 1]
        const record: NativeQueryRecord = { sample: reference.sample, index, routeId: host.state.currentRouteId!, fingerprint,
          nativeResultHash: ownerCutValueHash(native), witness: storeOwnerCutResult(native) }
        sample.allNativeQueries.push(record); save()
        record.historicalDifferences = expected ? ownerCutReferenceDifferences(expected, host, forbidden, native) : undefined
        save() // Preserve full control witness and diagnostics BEFORE every assertion.
        if (fingerprint !== ownerCutQueryFingerprint(host, forbidden)) throw new Error("Native preflight mutated its immutable context")
        if (expected) {
          assertOwnerCutHistoricalIdentity(expected, host, forbidden)
          const stored = storeOwnerCutResult(native)
          if (!stored.found) throw new Error(`Selected native preflight query ${index} is not feasible`)
          sample.queries.push({ ...expected, fingerprint, native: stored })
        }
        return native
      })
      if (sample.continuation.nativeQueryCount !== reference.expectedTotalNativeQueries || sample.queries.length !== reference.queries.length) {
        throw new Error(`Preselected sample ${reference.sample} query population changed`)
      }
      save()
    }
    if (ownerCutValueHash(provenance) !== ownerCutValueHash(getProvenance())) throw new Error("Preflight source/dependencies changed")
    report.status = "complete"
  } catch (error) {
    report.status = "failed"; report.error = error instanceof Error ? error.stack : String(error)
    throw error
  } finally { save() }
}

function loadPlatformReference(path: string, hash: string, provenance: ReturnType<typeof getProvenance>, runtime: ReturnType<typeof assertRuntime>): PlatformReferenceReport {
  if (!/^[a-f0-9]{64}$/.test(hash) || hashFile(path) !== hash) throw new Error("Frozen platform reference bytes changed")
  const report = JSON.parse(readFileSync(path, "utf8")) as PlatformReferenceReport
  const { processId: _preflightPid, ...preflightRuntime } = report.runtime
  const { processId: _passPid, ...passRuntime } = runtime
  if (report.schema !== 1 || report.status !== "complete" || report.historicalReferenceHash !== provenance.referenceHash ||
    ownerCutValueHash(report.provenance) !== ownerCutValueHash(provenance) ||
    ownerCutValueHash(preflightRuntime) !== ownerCutValueHash(passRuntime) || report.samples.length !== 2 ||
    report.samples[0]?.sample !== 6 || report.samples[0].queries.length !== 7 || report.samples[0].allNativeQueries.length !== 7 ||
    report.samples[1]?.sample !== 14 || report.samples[1].queries.length !== 12 || report.samples[1].allNativeQueries.length !== 35 ||
    report.samples.some((sample) => !sample.continuation || sample.continuation.nativeQueryCount !== sample.allNativeQueries.length)) {
    throw new Error("Platform reference source/runtime/population contract changed")
  }
  return report
}

async function runPass(arm: OwnerCutBenchmarkArm, directory: string, platformPath: string, platformHash: string): Promise<void> {
  const runtime = assertRuntime(), provenance = getProvenance(), historical = readHistoricalReference()
  const platform = loadPlatformReference(platformPath, platformHash, provenance, runtime)
  mkdirSync(directory, { recursive: true })
  const report: PassReport = { schema: 2, arm, status: "running", provenance, runtime, platformReferenceHash: platformHash,
    preflightProcessId: platform.runtime.processId, candidateWorkCap: maxCandidateWork, rows: [], controlQueries: [], continuations: [] }
  const save = (): void => writeFileSync(resolve(directory, "operator-report.json"), JSON.stringify(report, null, 2) + "\n")
  save()
  try {
    for (const [sampleIndex, reference] of historical.samples.entries()) {
      const frozen = platform.samples[sampleIndex]!
      const continuation = await replayNativeSample(reference.sample, (host, forbidden, callNative, index): OwnerCutBenchmarkResult => {
        const fingerprint = ownerCutQueryFingerprint(host, forbidden), expected = reference.queries[index - 1]
        let row: QueryRow | undefined, selected: ReturnType<typeof runColdOwnerCutOperator> | undefined
        if (expected) {
          row = { sample: reference.sample, queryIndex: index, routeId: host.state.currentRouteId!, fingerprint, status: "operator-started",
            expectedGraphReference: (expected as unknown as { capturedGraph: unknown }).capturedGraph,
            nativeExpandedCap: host.getRelaxedSearchExpansionLimit() }
          report.rows.push(row); save()
          // No selected-call warmup: preflight was a DIFFERENT process. Cold
          // logical setup and requested graph work remain inside this timer.
          Bun.gc(true)
          const memoryBefore = process.memoryUsage(), cpuBefore = process.cpuUsage(), started = performance.now()
          selected = runColdOwnerCutOperator(arm, host, forbidden, maxCandidateWork)
          const elapsedMs = performance.now() - started, cpuMicroseconds = process.cpuUsage(cpuBefore), memoryAfter = process.memoryUsage()
          Object.assign(row, { status: "control-started", elapsedMs, cpuMicroseconds, memoryBefore, memoryAfter,
            processMaxRssKiB: process.resourceUsage().maxRSS, selected: resultSummary(selected.result), selectedWitness: storeOwnerCutResult(selected.result),
            candidateWork: selected.candidate?.work, ownerMinimumProven: selected.candidate?.ownerMinimumProven,
            distanceMinimumProven: selected.candidate?.distanceMinimumProven })
          save()
          if (selected.candidate?.result.found && (!selected.candidate.ownerMinimumProven || !selected.candidate.distanceMinimumProven)) throw new Error("Uncertified candidate witness")
          if (fingerprint !== ownerCutQueryFingerprint(host, forbidden)) throw new Error("Selected operator mutated its immutable input")
        }
        // Always original native continuation, never a production fallback.
        const native = callNative(), nativeResultHash = ownerCutValueHash(native)
        const record: NativeQueryRecord = { sample: reference.sample, index, routeId: host.state.currentRouteId!, fingerprint,
          nativeResultHash, witness: storeOwnerCutResult(native) }
        report.controlQueries.push(record)
        if (row) Object.assign(row, { nativeResultHash, native: resultSummary(native), nativeWitness: storeOwnerCutResult(native) })
        save()
        const comparison = selected ? compareOwnerCutResults(native, selected.result) : undefined
        const differences = expected ? ownerCutReferenceDifferences(expected, host, forbidden, native) : undefined
        record.historicalDifferences = differences
        if (row) Object.assign(row, { nativeResultHash, native: resultSummary(native), nativeWitness: storeOwnerCutResult(native), comparison,
          historicalDifferences: differences, platformDifferences: ownerCutReferenceDifferences(frozen.queries[index - 1]!, host, forbidden, native) })
        save() // Full native witness/differences survive every reference assertion.
        if (selected && arm === "native" && nativeResultHash !== ownerCutValueHash(selected.result)) throw new Error("Cold native adapter differs from original native control")
        if (fingerprint !== ownerCutQueryFingerprint(host, forbidden)) throw new Error("Native reference mutated its immutable context")
        if (expected) {
          assertOwnerCutHistoricalIdentity(expected, host, forbidden)
          assertOwnerCutFrozenReference(frozen.queries[index - 1]!, host, forbidden, native)
        }
        const frozenQuery = frozen.allNativeQueries[index - 1]
        if (!frozenQuery || frozenQuery.fingerprint !== fingerprint || frozenQuery.nativeResultHash !== nativeResultHash || frozenQuery.routeId !== host.state.currentRouteId) throw new Error("Native continuation query differs from frozen preflight")
        if (row) { row.status = "complete"; save() }
        return native
      })
      report.continuations.push(continuation); save()
      if (continuation.nativeQueryCount !== reference.expectedTotalNativeQueries || ownerCutValueHash(continuation) !== ownerCutValueHash(frozen.continuation)) throw new Error("Native full port continuation differs from preflight")
    }
    if (ownerCutValueHash(provenance) !== ownerCutValueHash(getProvenance()) || hashFile(platformPath) !== platformHash) throw new Error("Benchmark source/dependency/reference provenance changed during pass")
    report.status = "complete"
  } catch (error) {
    report.status = "failed"; report.error = error instanceof Error ? error.stack : String(error)
    throw error
  } finally { save() }
}

/** A strict population audit; capped/missing/objective-only rows never earn a speed claim. */
export function auditOwnerCutPasses(reports: PassReport[], platformReferenceHash: string): Record<string, unknown> {
  if (!/^[a-f0-9]{64}$/.test(platformReferenceHash)) throw new Error("A frozen platform reference hash is required")
  if (reports.length !== order.length) throw new Error("Four fresh ABBA process reports are required")
  const reference = JSON.parse(readFileSync(referencePath, "utf8")) as OwnerCutBenchmarkReference
  const expectedRows = reference.samples.flatMap((sample) => sample.queries.map((query) => ({
    sample: sample.sample, queryIndex: query.index, routeId: query.routeId,
  })))
  const first = reports[0]!
  let exact = true
  for (const [index, report] of reports.entries()) {
    if (report.schema !== 2 || report.arm !== order[index] || report.status !== "complete" || report.platformReferenceHash !== platformReferenceHash ||
      report.preflightProcessId === report.runtime.processId || report.preflightProcessId !== first.preflightProcessId ||
      report.candidateWorkCap !== maxCandidateWork || report.controlQueries.length !== 42 || report.rows.length !== 19 || report.continuations.length !== 2) {
      throw new Error("Incomplete operator pass/population")
    }
    if (ownerCutValueHash(report.provenance) !== ownerCutValueHash(first.provenance)) throw new Error("Pass source/dependency provenance mismatch")
    const { processId: _firstPid, ...firstRuntime } = first.runtime
    const { processId: _pid, ...runtime } = report.runtime
    if (ownerCutValueHash(runtime) !== ownerCutValueHash(firstRuntime)) throw new Error("Pass runtime/resource mismatch")
    if (ownerCutValueHash(report.continuations) !== ownerCutValueHash(first.continuations)) throw new Error("Native replay continuation differs between passes")
    for (const [rowIndex, row] of report.rows.entries()) {
      const baseline = first.rows[rowIndex]!
      const expected = expectedRows[rowIndex]!
      if (row.status !== "complete" || row.sample !== expected.sample || row.queryIndex !== expected.queryIndex || row.routeId !== expected.routeId ||
        row.sample !== baseline.sample || row.queryIndex !== baseline.queryIndex || row.routeId !== baseline.routeId ||
        row.fingerprint !== baseline.fingerprint || row.nativeResultHash !== baseline.nativeResultHash) throw new Error("Ordered query provenance differs between passes")
      if (typeof row.elapsedMs !== "number" || !Number.isFinite(row.elapsedMs) || row.elapsedMs < 0) throw new Error("Invalid operator duration")
      const classification = (row.comparison as { classification: string }).classification
      if (!["exact", "unknown", "objective-only", "mismatch"].includes(classification)) throw new Error("Invalid comparison classification")
      if (classification !== "exact") exact = false
    }
  }
  const totals = reports.map((report) => ({ arm: report.arm, elapsedMs: report.rows.reduce((sum, row): number => sum + (row.elapsedMs as number), 0),
    classifications: report.rows.map((row) => (row.comparison as { classification: string }).classification) }))
  const nativeMs = totals.filter((row) => row.arm === "native").reduce((sum, row): number => sum + row.elapsedMs, 0)
  const candidateMs = totals.filter((row) => row.arm === "candidate").reduce((sum, row): number => sum + row.elapsedMs, 0)
  return { all19ExactAcrossPasses: exact, timedQueriesPerPass: 19, nativeControlQueriesPerPass: 42, platformReferenceHash, totals,
    fullPopulationCandidateOverNative: exact && nativeMs > 0 ? candidateMs / nativeMs : null,
    qualification: "Historical local-platform witness drift is diagnostic only; all current controls must exactly match a separate-process native preflight frozen before timers. Cold logical query setup and all requested hop/SCC/cut/master/distance work included; common preceding native replay, provenance and forced pre-query GC excluded identically. Selected call precedes the unconditional native control call in BOTH arms; first-use startup included, later queries naturally warm. Two replicates/revision only; no full-port or board timing claim. Missing/capped/non-equivalent rows invalidate full-population speed comparison. RSS values are process-level, not isolated allocation/GC attribution." }
}

/** A complete saved report cannot turn a killed or failed process into a successful pass. */
export function assertOwnerCutProcessCompletion(records: readonly OwnerCutChildRecord[]): void {
  if (records.length !== order.length) throw new Error("Four owner-cut child exit records are required")
  for (const [index, record] of records.entries()) {
    if (record.index !== index + 1 || record.arm !== order[index] || record.exitStatus !== 0 ||
      record.signal !== null || record.error !== undefined ||
      typeof record.reportHash !== "string" || !/^[a-f0-9]{64}$/.test(record.reportHash)) {
      throw new Error(`Owner-cut pass ${index + 1} did not exit successfully with a preserved report`)
    }
  }
}

export function runOwnerCutOperatorBenchmark(): void {
  const runtime = assertRuntime(), provenance = getProvenance()
  const directory = resolve(process.env.OWNER_CUT_OUTPUT_DIR ?? "tmp/owner-cut-operator")
  if (existsSync(directory)) throw new Error("Use a fresh owner-cut output directory")
  mkdirSync(directory, { recursive: true })
  const manifest: Record<string, unknown> = { schema: 2, status: "running", runtime, provenance, order,
    maxCandidateWork, passTimeoutMs, routingThreads: 1, generationPolicy: "Native baseline replay identical and excluded in all arms; cold selected adapter includes native hop generation.", passes: [] }
  const records = manifest.passes as OwnerCutChildRecord[]
  const reports: PassReport[] = []
  const save = (): void => writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  save()
  try {
    const preflightDirectory = resolve(directory, "0-preflight")
    mkdirSync(preflightDirectory)
    const descriptor = openSync(resolve(preflightDirectory, "preflight.log"), "w")
    let preflight: ReturnType<typeof spawnSync>
    try {
      preflight = spawnSync(process.execPath, [import.meta.path, "--preflight", preflightDirectory], {
        env: process.env, stdio: ["ignore", descriptor, descriptor], timeout: passTimeoutMs,
      })
    } finally { closeSync(descriptor) }
    const platformPath = resolve(preflightDirectory, "platform-reference.json")
    manifest.preflight = { exitStatus: preflight.status, signal: preflight.signal, error: preflight.error?.message,
      logHash: hashFile(resolve(preflightDirectory, "preflight.log")), referenceHash: existsSync(platformPath) ? hashFile(platformPath) : undefined }
    save()
    if (preflight.status !== 0 || preflight.signal !== null || preflight.error || !existsSync(platformPath)) throw new Error("Untimed native preflight did not exit successfully")
    const platformHash = hashFile(platformPath)
    const frozen = loadPlatformReference(platformPath, platformHash, provenance, runtime)
    chmodSync(platformPath, 0o444)
    manifest.platformReferenceHash = platformHash
    manifest.preflightProcessId = frozen.runtime.processId
    manifest.generationPolicy = "Fresh separate-process untimed native preflight freezes first 7/12 and all 7/35 continuations under the same source/runtime/lock before four fresh ABBA processes. No selected warmup; historical identity remains fixed."
    save()
    for (const [index, arm] of order.entries()) {
      const passDirectory = resolve(directory, `${index + 1}-${arm}`)
      mkdirSync(passDirectory)
      const descriptor = openSync(resolve(passDirectory, "operator.log"), "w")
      let result: ReturnType<typeof spawnSync>
      try {
        result = spawnSync(process.execPath, [import.meta.path, "--pass", arm, passDirectory, platformPath, platformHash], {
          env: process.env, stdio: ["ignore", descriptor, descriptor], timeout: passTimeoutMs,
        })
      } finally { closeSync(descriptor) }
      const reportPath = resolve(passDirectory, "operator-report.json")
      const record: OwnerCutChildRecord = { index: index + 1, arm, exitStatus: result.status, signal: result.signal,
        error: result.error?.message, logHash: hashFile(resolve(passDirectory, "operator.log")) }
      if (existsSync(reportPath)) {
        record.reportHash = hashFile(reportPath)
        reports.push(JSON.parse(readFileSync(reportPath, "utf8")) as PassReport)
      }
      records.push(record); save()
      // Continue the independent later passes after an explicit failed/killed
      // process to preserve evidence. No row/result is substituted or repaired.
    }
    assertOwnerCutProcessCompletion(records)
    if (hashFile(platformPath) !== platformHash) throw new Error("Frozen platform reference changed after ABBA")
    manifest.audit = auditOwnerCutPasses(reports, platformHash)
    manifest.status = "complete"
  } catch (error) {
    manifest.status = "incomplete"; manifest.error = error instanceof Error ? error.stack : String(error)
    process.exitCode = 1
  } finally { save() }
}

if (import.meta.main) {
  if (process.argv[2] === "--preflight") await runPreflight(resolve(process.argv[3]!))
  else if (process.argv[2] === "--pass") {
    const arm = process.argv[3]
    if (arm !== "native" && arm !== "candidate") throw new Error("Pass arm must be native or candidate")
    await runPass(arm, resolve(process.argv[4]!), resolve(process.argv[5]!), process.argv[6]!)
  } else runOwnerCutOperatorBenchmark()
}
