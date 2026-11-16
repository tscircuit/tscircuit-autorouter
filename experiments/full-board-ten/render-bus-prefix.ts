import { createHash } from "node:crypto"
import { readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"

type PackageIdentity = { name: string; version: string; entrySha256: string }
type ResolvedPackageIdentity = PackageIdentity & { entry: string; publishedEntrySha256: string }
type CapturedPhase = { index: number; name: string; inputSha256: string; status: string; solver: string }
type CapturedProgress = {
  id: string; cohort: string; experiment: string; sourceSha256: string
  phases: CapturedPhase[]; runtime: { packages: PackageIdentity[] }
}
type ReleaseIdentity = { mainVersion: string; packages: PackageIdentity[] }
type GridInstrumentation = { originalCoreEntry: string; originalCoreSha256: string; instrumentedEntry: string; instrumentedCoreSha256: string; counterOnly: boolean; algorithmChanged: boolean; profiled: boolean }
type RuntimeManifest = { experiment: string; dependencyOverrides: unknown[]; packages: PackageIdentity[]; gridCensusInstrumentation: GridInstrumentation }
type PublishedBusInput = ConstructorParameters<typeof SOLVERS.BusLanesPipelineSolver>[0]
type BoardGridKey = string
type GridCall = { input: object; key: BoardGridKey; hit: boolean; nx: number; ny: number; firstX: number; lastX: number; firstY: number; lastY: number; step: number; copperRadiusMm: number }
type GridKeyRow = Omit<GridCall, "input" | "hit"> & { id: number; calls: number; hits: number; misses: number; missCells: number; keyLength: number }
type GridInputRow = { id: number; calls: number; hits: number; misses: number; missCells: number }
type GridTransition = { call: number; inputId: number; keyId: number | null; hit: boolean; cells: number }

const [inputArg, outputArg] = process.argv.slice(2)
if (!inputArg || !outputArg || Bun.version !== "1.4.3") throw new Error("Usage: Bun1.4.3 render-bus-prefix.ts INPUT_DIR OUTPUT")
const inputDirectory = resolve(inputArg), output = resolve(outputArg)
const sha = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex")
const inputPath = join(inputDirectory, "phase-2-input.srj.json.gz")
const progressPath = join(inputDirectory, "progress.json")
const identityPath = join(inputDirectory, "artifact-identity.json")
const manifestPath = process.env.FULL_BOARD_RUNTIME_MANIFEST
if (!manifestPath) throw new Error("Verified published runtime manifest required")
const releasePath = join(import.meta.dir, "release.json")
const artifact = JSON.parse(readFileSync(identityPath, "utf8"))
if (artifact.repository !== "tscircuit/tscircuit-autorouter" || artifact.runId !== 43929516030 || artifact.artifactId !== 14259406094 || artifact.headSha !== "4faeb09514467a8b0804688328bc393206c4b614" || artifact.name !== "full-board-imx6-published-spaced-1" || artifact.expired !== false || artifact.sizeInBytes !== 14582165 || artifact.digest !== "sha256:d991063caf8773c76c95b202d08374c61416f7241dfdc129e519fc310eb4bb42") throw new Error("Unexpected source artifact identity")
const compressed = readFileSync(inputPath)
if (sha(compressed) !== "1486908e405cf2675f22f8c69146160bc35da38e25432936c09cbea4a6a254df") throw new Error("Genuine byte1 gzip hash mismatch")
const raw = gunzipSync(compressed)
const inputSha256 = sha(raw)
if (inputSha256 !== "f86791279e8f787d434621699d8eab42d475ef4c4bd4d92a3b1f87144dc881df") throw new Error("Genuine byte1 SRJ hash mismatch")
const priorBytes = readFileSync(progressPath)
if (sha(priorBytes) !== "db5f937b9b49e63be2cafe806b5a501fe909ece1db6e8f592d344a4f20e8cd80") throw new Error("Genuine published progress hash mismatch")
const prior: CapturedProgress = JSON.parse(priorBytes.toString())
const priorPhase = prior.phases.find((phase): boolean => phase.index === 2 && phase.name === "byte1")
if (prior.id !== "imx6" || prior.cohort !== "spaced" || prior.experiment !== "published" || priorPhase?.inputSha256 !== inputSha256 || priorPhase.status !== "completed" || priorPhase.solver !== "BusLanesPipelineSolver") throw new Error("Source phase is not the genuine published byte1 control")
const input: PublishedBusInput = JSON.parse(raw.toString())
// The published Core adapter is a structural no-op for this exact payload.
if (!input.traces || new Set(input.traces.map((trace): string => trace.pcb_trace_id)).size !== 8 || input.traces.some((trace): boolean => !trace.route.length || trace.route.some((segment): boolean => !["wire", "via"].includes(segment.route_type)))) throw new Error("Source traces require the internal Core adapter; direct replay is not equivalent")
const release: ReleaseIdentity = JSON.parse(readFileSync(releasePath, "utf8"))
const manifest: RuntimeManifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const instrumentation = manifest.gridCensusInstrumentation
if (!instrumentation?.counterOnly || instrumentation.algorithmChanged || instrumentation.profiled || instrumentation.originalCoreSha256 !== "99ba251a6138c40982b6132736fd8731e30d3498e4bf712b2fcb7f8448442af5" || instrumentation.instrumentedCoreSha256 !== "737a6e2616281e2c70dfa7ced6423540029f8b3f44863e3a8613170b54fab58d" || sha(readFileSync(instrumentation.originalCoreEntry)) !== instrumentation.originalCoreSha256) throw new Error("Exact counter-only Core instrumentation required")
const expectedNames = ["tscircuit", "@tscircuit/core", "@tscircuit/eval", "@tscircuit/capacity-autorouter"]
if (release.mainVersion !== "0.0.3203" || manifest.experiment !== "published" || manifest.dependencyOverrides.length !== 0 || manifest.packages.length !== 4 || prior.runtime.packages.length !== 4) throw new Error("Published runtime identity mismatch")
const runtime = expectedNames.map((name): ResolvedPackageIdentity => {
  const expected = release.packages.find((row): boolean => row.name === name)
  const actual = manifest.packages.find((row): boolean => row.name === name)
  const captured = prior.runtime.packages.find((row): boolean => row.name === name)
  if (!expected || !actual || !captured || [actual, captured].some(row => row.version !== expected.version || row.entrySha256 !== expected.entrySha256)) throw new Error(`Published package chain differs for ${name}`)
  const entry = fileURLToPath(import.meta.resolve(name))
  const entrySha256 = name === "@tscircuit/core" ? instrumentation.instrumentedCoreSha256 : expected.entrySha256
  if (name === "@tscircuit/core" && entry !== instrumentation.instrumentedEntry) throw new Error("Core did not resolve to the private instrumented copy")
  if (sha(readFileSync(entry)) !== entrySha256) throw new Error(`Runtime entry hash mismatch for ${name}`)
  return { name, version: expected.version, entry, entrySha256, publishedEntrySha256: expected.entrySha256 }
})
const immutableFiles = [inputPath, progressPath, identityPath, manifestPath, releasePath, instrumentation.originalCoreEntry, ...runtime.map(row => row.entry)].map(path => ({ path, sha256: sha(readFileSync(path)) }))

// Observe the existing lookup result without retaining inputs or changing its cache.
const gridCensus = {
  calls: 0, hits: 0, misses: 0, missCells: 0, inputCount: 0,
  maxKeyLength: 0, maxGridCells: 0, keyCallsOmitted: 0, inputCallsOmitted: 0,
  transitionsOmitted: 0, keys: [] as GridKeyRow[], inputs: [] as GridInputRow[], transitions: [] as GridTransition[],
  callSequence: [] as [number, number | null, boolean][], callSequenceOmitted: 0,
  missCellsScope: "Cells requested for classification on misses; hook precedes classification. Interrupted calls are not proven completed.",
  callSequenceColumns: ["inputId", "keyIdOrNull", "hit"],
  limits: { keyRows: 16, keyCharacters: 8192, inputRows: 16, transitions: 64, callSequence: 8192 },
}
const inputIds = new WeakMap<object, number>()
const keyRows = new Map<BoardGridKey, GridKeyRow>()
let previousGridKey: BoardGridKey | undefined
let previousGridInput = 0
const censusGlobal = globalThis as typeof globalThis & { __tscircuitBoardGridAudit?: (call: GridCall) => void }
if (censusGlobal.__tscircuitBoardGridAudit) throw new Error("Unexpected existing board grid observer")
censusGlobal.__tscircuitBoardGridAudit = (call): void => {
  const cells = call.nx * call.ny
  if (!Number.isSafeInteger(cells) || cells < 0) throw new Error("Invalid board grid dimensions")
  gridCensus.calls++
  if (call.hit) gridCensus.hits++
  else { gridCensus.misses++; gridCensus.missCells += cells }
  gridCensus.maxKeyLength = Math.max(gridCensus.maxKeyLength, call.key.length)
  gridCensus.maxGridCells = Math.max(gridCensus.maxGridCells, cells)
  let inputId = inputIds.get(call.input)
  if (inputId === undefined) { inputId = ++gridCensus.inputCount; inputIds.set(call.input, inputId) }
  let inputRow = gridCensus.inputs[inputId - 1]
  if (!inputRow && inputId <= gridCensus.limits.inputRows) {
    inputRow = { id: inputId, calls: 0, hits: 0, misses: 0, missCells: 0 }
    gridCensus.inputs.push(inputRow)
  }
  if (inputRow) {
    inputRow.calls++
    if (call.hit) inputRow.hits++
    else { inputRow.misses++; inputRow.missCells += cells }
  } else gridCensus.inputCallsOmitted++
  let keyRow = keyRows.get(call.key)
  if (!keyRow && keyRows.size < gridCensus.limits.keyRows && call.key.length <= gridCensus.limits.keyCharacters) {
    keyRow = { id: keyRows.size + 1, key: call.key, keyLength: call.key.length, nx: call.nx, ny: call.ny,
      firstX: call.firstX, lastX: call.lastX, firstY: call.firstY, lastY: call.lastY, step: call.step,
      copperRadiusMm: call.copperRadiusMm, calls: 0, hits: 0, misses: 0, missCells: 0 }
    keyRows.set(call.key, keyRow)
    gridCensus.keys.push(keyRow)
  }
  if (keyRow) {
    keyRow.calls++
    if (call.hit) keyRow.hits++
    else { keyRow.misses++; keyRow.missCells += cells }
  } else gridCensus.keyCallsOmitted++
  if (gridCensus.callSequence.length < gridCensus.limits.callSequence) gridCensus.callSequence.push([inputId, keyRow?.id ?? null, call.hit])
  else gridCensus.callSequenceOmitted++
  if (call.key !== previousGridKey || inputId !== previousGridInput) {
    if (gridCensus.transitions.length < gridCensus.limits.transitions) gridCensus.transitions.push({ call: gridCensus.calls, inputId, keyId: keyRow?.id ?? null, hit: call.hit, cells })
    else gridCensus.transitionsOmitted++
    previousGridKey = call.key
    previousGridInput = inputId
  }
}

// Preserve the established cold-import accounting, then forbid routing WASM.
const wasmUsage = { coldMainImportCalls: 0, coldMainImportStacks: [] as string[], routingOrUnknownAttempts: 0 }
let importingPublishedMain = true
const guarded = new Set(["Module", "Instance", "Memory", "compile", "instantiate", "compileStreaming", "instantiateStreaming"])
const wrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(globalThis.WebAssembly, {
  get(target, key, receiver): unknown {
    const value = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return value
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => {
      if (importingPublishedMain) {
        wasmUsage.coldMainImportCalls++
        if (wasmUsage.coldMainImportStacks.length < 4) wasmUsage.coldMainImportStacks.push((new Error().stack ?? "").slice(0, 1200))
        return
      }
      wasmUsage.routingOrUnknownAttempts++
      throw new Error("Routing or unknown WebAssembly is disabled for the native byte1 prefix")
    }
    const wrapped = new Proxy(value, {
      apply(fn, thisArg, args): unknown { check(); return Reflect.apply(fn, thisArg, args) },
      construct(fn, args): object { check(); return Reflect.construct(fn, args) },
    })
    wrappers.set(key, wrapped)
    return wrapped
  },
})
const { SOLVERS } = await import("tscircuit")
importingPublishedMain = false
if (typeof SOLVERS.BusLanesPipelineSolver !== "function") throw new Error("Published BusLanes solver is not registered")
const prefixMs = 120000
const started = performance.now()
let solver: InstanceType<typeof SOLVERS.BusLanesPipelineSolver> | undefined
let lastSavedMs = -Infinity
let finished = false
const phaseHistory: { elapsedMs: number; phase: string; iterations: number }[] = []
let phaseTransitionsOmitted = 0
let lastPhase: string | undefined

const save = (status: string, error?: string): void => {
  const elapsedMs = performance.now() - started
  const phase = solver ? String(solver.phase).slice(0, 120) : "constructor"
  if (phase !== lastPhase) {
    if (phaseHistory.length < 24) phaseHistory.push({ elapsedMs, phase, iterations: solver?.iterations ?? 0 })
    else phaseTransitionsOmitted++
    lastPhase = phase
  }
  const stats: Record<string, unknown> = {}
  if (solver) for (const key of ["carrierStrategy", "carrierStrategyStartedAtIteration", "optimizationStoppedEarly"]) {
    const value = solver.stats[key]
    if (["number", "boolean"].includes(typeof value)) stats[key] = value
    else if (typeof value === "string") stats[key] = value.slice(0, 120)
  }
  const progress = {
    id: "imx6", cohort: "spaced", sourceSha256: prior.sourceSha256, status, error: error?.slice(0, 600) ?? null,
    scope: "Actual-input cold-cache byte1 prefix; not a full-board routing or completion result",
    sourceArtifact: artifact, phaseInputSha256: inputSha256,
    runtime: { packages: runtime, candidateOverride: false, routingSourceOverride: true, cacheEngine: false, gridCensusInstrumentation: instrumentation },
    captureDeadlineMs: prefixMs, hardDeadlineMs: 180000, assessmentDeadlineMs: null,
    elapsedMs, cutoffOvershootMs: Math.max(0, elapsedMs - prefixMs),
    solver: solver ? { name: "BusLanesPipelineSolver", phase, iterations: solver.iterations, MAX_ITERATIONS: solver.MAX_ITERATIONS, progress: solver.progress, solved: solver.solved, failed: solver.failed, error: solver.error?.slice(0, 600) ?? null, observedTraceCount: solver.traces.length, stats } : null,
    phases: [{ name: "byte1", index: 2, status, startedMs: 0, elapsedMs, inputSha256, connections: 8, terminals: 17 }],
    phaseHistory, phaseTransitionsOmitted, wasmUsage, postHashesVerified: finished, gridCensus,
    completionClaim: false,
  }
  const encoded = JSON.stringify(progress, null, 2)
  if (Buffer.byteLength(encoded) > 1000000) throw new Error("Prefix progress exceeds bounded record size")
  writeFileSync(join(output, "progress.json.tmp"), encoded)
  renameSync(join(output, "progress.json.tmp"), join(output, "progress.json"))
  lastSavedMs = elapsedMs
}

const finish = (status: string, error?: string): never => {
  for (const file of immutableFiles) if (sha(readFileSync(file.path)) !== file.sha256) throw new Error(`Authoritative file changed during prefix: ${file.path}`)
  finished = true
  save(status, error)
  process.exit(status === "diagnostic_error" ? 1 : 0)
}

const tick = (): void => {
  try {
    if (!solver) throw new Error("Prefix solver was not constructed")
    for (let index = 0; index < 200; index++) {
      if (solver.solved || solver.failed) finish(solver.solved ? "phase_solved" : "phase_failed")
      if (performance.now() - started >= prefixMs) finish("diagnostic_prefix_cutoff")
      solver.step()
      if (solver.solved || solver.failed) finish(solver.solved ? "phase_solved" : "phase_failed")
      if (performance.now() - started >= prefixMs) finish("diagnostic_prefix_cutoff")
    }
    if (performance.now() - started - lastSavedMs >= 5000) save("diagnostic_running")
    setImmediate(tick)
  } catch (error) {
    finish("diagnostic_error", error instanceof Error ? error.message : String(error))
  }
}
try {
  solver = new SOLVERS.BusLanesPipelineSolver(input)
  save("diagnostic_running")
  setImmediate(tick)
} catch (error) {
  finish("diagnostic_error", error instanceof Error ? error.message : String(error))
}
