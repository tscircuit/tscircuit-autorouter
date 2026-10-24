import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  assertOwnerCutReference, compareOwnerCutResults, ownerCutQueryFingerprint, ownerCutValueHash,
  runColdOwnerCutOperator, type OwnerCutBenchmarkArm, type OwnerCutBenchmarkHost,
  type OwnerCutBenchmarkReference, type OwnerCutBenchmarkResult, type OwnerCutReferenceSample,
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
  candidateWorkCap: number; rows: QueryRow[]; continuations: unknown[]; error?: string
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

async function replaySample(reference: OwnerCutReferenceSample, report: PassReport, save: () => void): Promise<void> {
  const { TinyHyperGraphSolver, SelectiveReripTinyHyperGraphSolver } = await import("tiny-hypergraph/lib/index")
  const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import("../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph")
  const { loadScenarioBySampleNumber } = await import("./scenarios")
  const { scenario } = await loadScenarioBySampleNumber("srj18", reference.sample)
  const scenarioHash = ownerCutValueHash(scenario)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  const installed = new WeakSet<object>()
  let queryCount = 0, expandedTotal = 0, captured = 0
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
      queryCount++
      const expected = reference.queries[queryCount - 1]
      const fingerprint = expected ? ownerCutQueryFingerprint(instance, forbidden) : undefined
      if (!expected) {
        const native = original.call(solver, forbidden)
        expandedTotal += native.expandedLabelCount
        return native
      }
      const row: QueryRow = { sample: reference.sample, queryIndex: queryCount, routeId: instance.state.currentRouteId!,
        fingerprint: fingerprint!, status: "operator-started",
        expectedGraphReference: (expected as unknown as { capturedGraph: unknown }).capturedGraph,
        nativeExpandedCap: instance.getRelaxedSearchExpansionLimit() }
      report.rows.push(row); save()
      // Provenance serialization and common preceding baseline replay are
      // outside BOTH timers. There is NO unmeasured operator warmup here:
      // selected cold call precedes native control in BOTH arms, so first-use
      // startup is charged. Force identical GC immediately before each call.
      Bun.gc(true)
      const memoryBefore = process.memoryUsage()
      const cpuBefore = process.cpuUsage()
      const started = performance.now()
      const selected = runColdOwnerCutOperator(report.arm, instance, forbidden, maxCandidateWork)
      const elapsedMs = performance.now() - started
      const cpuMicroseconds = process.cpuUsage(cpuBefore)
      const memoryAfter = process.memoryUsage()
      if (selected.candidate?.result.found && (!selected.candidate.ownerMinimumProven || !selected.candidate.distanceMinimumProven)) {
        throw new Error("Candidate published a witness before both exact objectives were certified")
      }
      if (fingerprint !== ownerCutQueryFingerprint(instance, forbidden)) throw new Error("Selected operator mutated its immutable input")
      Object.assign(row, { status: "control-started", elapsedMs, cpuMicroseconds, memoryBefore, memoryAfter,
        processMaxRssKiB: process.resourceUsage().maxRSS, selected: resultSummary(selected.result),
        candidateWork: selected.candidate?.work, ownerMinimumProven: selected.candidate?.ownerMinimumProven,
        distanceMinimumProven: selected.candidate?.distanceMinimumProven })
      save()
      // Deliberate standalone replay control, NOT a production fallback: this
      // unconditional native call is outside timers and alone drives later
      // port routing in BOTH arms, including when the candidate caps unknown.
      const native = original.call(solver, forbidden)
      expandedTotal += native.expandedLabelCount
      assertOwnerCutReference(expected, instance, forbidden, native)
      if (fingerprint !== ownerCutQueryFingerprint(instance, forbidden)) throw new Error("Native reference query mutated its immutable input")
      const comparison = compareOwnerCutResults(native, selected.result)
      if (report.arm === "native" && ownerCutValueHash(native) !== ownerCutValueHash(selected.result)) {
        throw new Error("Cold native adapter differs from the original native query result")
      }
      Object.assign(row, { status: "complete", nativeResultHash: ownerCutValueHash(native),
        native: resultSummary(native), comparison })
      captured++; save()
      console.log(JSON.stringify({ phase: "operator-complete", sample: reference.sample, query: queryCount, arm: report.arm, classification: comparison.classification }))
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
  if (!port?.solved || pipeline.failed || captured !== reference.queries.length ||
    queryCount !== reference.expectedTotalNativeQueries || expandedTotal !== reference.expectedTotalNativeExpanded) {
    throw new Error(`Native sample ${reference.sample} continuation/query population differs from the captured reference`)
  }
  report.continuations.push({ sample: reference.sample, scenarioHash, captured, nativeQueryCount: queryCount,
    nativeExpandedTotal: expandedTotal, portSolved: port.solved, portIterations: port.iterations,
    portOutputHash: ownerCutValueHash(port.getOutput()) })
  save()
}

async function runPass(arm: OwnerCutBenchmarkArm, directory: string): Promise<void> {
  const runtime = assertRuntime(), provenance = getProvenance()
  const reference = JSON.parse(readFileSync(referencePath, "utf8")) as OwnerCutBenchmarkReference
  if (reference.schema !== 1 || reference.base !== "b9d32a05c76af701d518f6a78a3114e68addd144" || reference.kernelCommit !== kernelCommit ||
    reference.samples.length !== 2 || reference.samples[0]?.sample !== 6 || reference.samples[0].queries.length !== 7 ||
    reference.samples[1]?.sample !== 14 || reference.samples[1].queries.length !== 12 ||
    reference.samples.some((sample) => sample.queries.some((query, index) => query.index !== index + 1))) {
    throw new Error("Expected immutable19-query reference population")
  }
  mkdirSync(directory, { recursive: true })
  const report: PassReport = { schema: 1, arm, status: "running", provenance, runtime,
    candidateWorkCap: maxCandidateWork, rows: [], continuations: [] }
  const save = (): void => writeFileSync(resolve(directory, "operator-report.json"), JSON.stringify(report, null, 2) + "\n")
  save()
  try {
    for (const sample of reference.samples) await replaySample(sample, report, save)
    if (ownerCutValueHash(provenance) !== ownerCutValueHash(getProvenance())) throw new Error("Benchmark source/dependency provenance changed during pass")
    report.status = "complete"
  } catch (error) {
    report.status = "failed"; report.error = error instanceof Error ? error.stack : String(error)
    throw error
  } finally { save() }
}

/** A strict population audit; capped/missing/objective-only rows never earn a speed claim. */
export function auditOwnerCutPasses(reports: PassReport[]): Record<string, unknown> {
  if (reports.length !== order.length) throw new Error("Four fresh ABBA process reports are required")
  const reference = JSON.parse(readFileSync(referencePath, "utf8")) as OwnerCutBenchmarkReference
  const expectedRows = reference.samples.flatMap((sample) => sample.queries.map((query) => ({
    sample: sample.sample, queryIndex: query.index, routeId: query.routeId,
  })))
  const first = reports[0]!
  let exact = true
  for (const [index, report] of reports.entries()) {
    if (report.arm !== order[index] || report.status !== "complete" || report.rows.length !== 19 || report.continuations.length !== 2) {
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
  return { all19ExactAcrossPasses: exact, totals,
    fullPopulationCandidateOverNative: exact && nativeMs > 0 ? candidateMs / nativeMs : null,
    qualification: "Cold logical query setup and all requested hop/SCC/cut/master/distance work included; common preceding native replay, provenance and forced pre-query GC excluded identically. Selected call precedes the unconditional native control call in BOTH arms; first-use startup included, later queries naturally warm. Two replicates/revision only; no full-port or board timing claim. Missing/capped/non-equivalent rows invalidate full-population speed comparison. RSS values are process-level, not isolated allocation/GC attribution." }
}

export function runOwnerCutOperatorBenchmark(): void {
  const runtime = assertRuntime(), provenance = getProvenance()
  const directory = resolve(process.env.OWNER_CUT_OUTPUT_DIR ?? "tmp/owner-cut-operator")
  if (existsSync(directory)) throw new Error("Use a fresh owner-cut output directory")
  mkdirSync(directory, { recursive: true })
  const manifest: Record<string, unknown> = { schema: 1, status: "running", runtime, provenance, order,
    maxCandidateWork, passTimeoutMs, routingThreads: 1, generationPolicy: "Native baseline replay identical and excluded in all arms; cold selected adapter includes native hop generation.", passes: [] }
  const records = manifest.passes as Array<Record<string, unknown>>
  const reports: PassReport[] = []
  const save = (): void => writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  save()
  try {
    for (const [index, arm] of order.entries()) {
      const passDirectory = resolve(directory, `${index + 1}-${arm}`)
      mkdirSync(passDirectory)
      const descriptor = openSync(resolve(passDirectory, "operator.log"), "w")
      let result: ReturnType<typeof spawnSync>
      try {
        result = spawnSync(process.execPath, [import.meta.path, "--pass", arm, passDirectory], {
          env: process.env, stdio: ["ignore", descriptor, descriptor], timeout: passTimeoutMs,
        })
      } finally { closeSync(descriptor) }
      const reportPath = resolve(passDirectory, "operator-report.json")
      const record: Record<string, unknown> = { index: index + 1, arm, exitStatus: result.status, signal: result.signal,
        error: result.error?.message, logHash: hashFile(resolve(passDirectory, "operator.log")) }
      if (existsSync(reportPath)) {
        record.reportHash = hashFile(reportPath)
        reports.push(JSON.parse(readFileSync(reportPath, "utf8")) as PassReport)
      }
      records.push(record); save()
      // Continue the independent later passes after an explicit failed/killed
      // process to preserve evidence. No row/result is substituted or repaired.
    }
    manifest.audit = auditOwnerCutPasses(reports)
    manifest.status = "complete"
  } catch (error) {
    manifest.status = "incomplete"; manifest.error = error instanceof Error ? error.stack : String(error)
    process.exitCode = 1
  } finally { save() }
}

if (import.meta.main) {
  if (process.argv[2] === "--pass") {
    const arm = process.argv[3]
    if (arm !== "native" && arm !== "candidate") throw new Error("Pass arm must be native or candidate")
    await runPass(arm, resolve(process.argv[4]!))
  } else runOwnerCutOperatorBenchmark()
}
