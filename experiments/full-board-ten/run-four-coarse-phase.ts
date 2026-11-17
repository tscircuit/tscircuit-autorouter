import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gzipSync, gunzipSync } from "node:zlib"
import { createCoarseRoutingDiagnostics } from "./createCoarseRoutingDiagnostics"
import { createCoarseFailureObserver } from "./createCoarseFailureObserver"

const [runtimePath, output] = process.argv.slice(2)
assert(runtimePath && output, "Usage: run-four-coarse-phase.ts RUNTIME.json OUTPUT")
mkdirSync(output, { recursive: true })
const runtime = JSON.parse(readFileSync(runtimePath, "utf8"))
const sha = (contents: string | Uint8Array): string => createHash("sha256").update(contents).digest("hex")
assert.equal(sha(readFileSync(runtime.selectedAutorouterEntry)), runtime.selectedAutorouterSha256)
const inputBytes = gunzipSync(readFileSync(runtime.inputPath))
assert.equal(sha(inputBytes), runtime.inputSha256)
const input = JSON.parse(inputBytes.toString())
const atomicJson = (name: string, report: unknown): void => {
  const target = join(output, name)
  writeFileSync(`${target}.tmp`, JSON.stringify(report, null, 2))
  renameSync(`${target}.tmp`, target)
}

// The same WASM policy as the native full-board harness: no routing WASM.
const wasmUsage = { coldImportCalls: 0, geometryCalls: 0, routingOrUnknownAttempts: 0 }
let importingPublishedAutorouter = true
const copperModule = fileURLToPath(import.meta.resolve("@tscircuit/copper-pour-solver"))
const geometryModuleOrigins = [...new Set([import.meta.dir, dirname(copperModule)].flatMap(context => ["@tscircuit/manifold-2d", "@tscircuit/manifold-2d/manifold"].flatMap(name => {
  const path = Bun.resolveSync(name, context)
  return [path, realpathSync(path)]
})))]
const nativeWasm = globalThis.WebAssembly
const guarded = new Set(["Module", "Instance", "Memory", "compile", "instantiate", "compileStreaming", "instantiateStreaming"])
const wrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(nativeWasm, {
  get(target, key, receiver): unknown {
    const original = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return original
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => {
      if (importingPublishedAutorouter) { wasmUsage.coldImportCalls++; return }
      const stack = new Error().stack ?? ""
      if (!geometryModuleOrigins.some(origin => stack.includes(origin)) || /krt-wasm|krt_wasm/i.test(stack)) {
        wasmUsage.routingOrUnknownAttempts++
        throw new Error("Routing or unknown WebAssembly is disabled for the native phase replay")
      }
      wasmUsage.geometryCalls++
    }
    const wrapped = new Proxy(original, {
      apply(fn, thisArg, args): unknown { check(); return Reflect.apply(fn, thisArg, args) },
      construct(fn, args): object { check(); return Reflect.construct(fn, args) },
    })
    wrappers.set(key, wrapped)
    return wrapped
  },
})

const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(pathToFileURL(runtime.selectedAutorouterEntry).href)
importingPublishedAutorouter = false
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
  capacityDepth: undefined,
  targetMinCapacity: undefined,
  cacheProvider: null,
  effort: undefined,
})
assert.equal(typeof pipeline.stepAsync, "undefined", "Core stepping contract changed")
assert.equal(typeof pipeline.getCurrentPhase, "function", "Missing native P9 phase accessor")
assert.equal(typeof pipeline.getOutputSimpleRouteJson, "function", "Missing native P9 output accessor")
const nativeObserver = createCoarseRoutingDiagnostics({
  pipelineClass: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  registeredPipelineClass: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  targetPhase: runtime.case.phase,
  onSnapshot: (report) => atomicJson("primary-coarse-observation.json", report),
})
// Replay the archived event payload through the unchanged native observer.
nativeObserver.onSolverStarted({
  solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  solverParams: { input },
}, runtime.case.phase)
const coarseObserver = createCoarseFailureObserver({ captureNumericSnapshot: false })
const stages: Array<{ name: string; solver: any; firstPipelineIteration: number }> = []
let highDensity: any
let activeHdNode: string | null = null
const observePipeline = (): void => {
  coarseObserver.afterPipelineStep(pipeline)
  const active = pipeline.activeSubSolver
  if (active && stages.at(-1)?.solver !== active) {
    assert(stages.length < 64, "Unexpected pipeline stage count")
    stages.push({ name: pipeline.getCurrentPhase(), solver: active, firstPipelineIteration: pipeline.iterations })
  }
  if (pipeline.highDensityRouteSolver) highDensity = pipeline.highDensityRouteSolver
  if (highDensity?.activeNode) activeHdNode = highDensity.activeNode.capacityMeshNodeId
}
let primaryReport: Record<string, any> | null = null
let coarseReport: Record<string, any> = { observationErrors: [] }
let timedOut = false
let thrownError: string | null = null
let outputSummary: Record<string, unknown> | null = null
let routingElapsedMs = 0
const started = performance.now()
let lastFlush = started
const checkpoint = (): void => {
  const progress = {
    case: runtime.case.id, variant: runtime.variant, elapsedMs: performance.now() - started,
    solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error,
    iterations: pipeline.iterations, stage: pipeline.getCurrentPhase(), wasmUsage,
  }
  atomicJson("progress.json", progress)
  console.log(`COARSE_PHASE_PROGRESS ${JSON.stringify(progress)}`)
}
try {
  observePipeline()
  while (!pipeline.solved && !pipeline.failed) {
    const batchStarted = performance.now()
    do {
      pipeline.step()
      observePipeline()
      if (performance.now() - started >= 900000) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) {
      checkpoint()
      lastFlush = performance.now()
    }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise(resolve => setTimeout(resolve, 0))
  }
} catch (error) {
  thrownError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error).slice(0, 8000)
} finally {
  routingElapsedMs = performance.now() - started
  try {
    coarseReport = coarseObserver.finish().report
  } finally {
    coarseObserver.dispose()
    primaryReport = nativeObserver.finish()
    globalThis.WebAssembly = nativeWasm
  }
  atomicJson("primary-coarse-observation.json", primaryReport)
  atomicJson("coarse-recovery-observation.json", JSON.parse(JSON.stringify(coarseReport,
    (_key, value) => typeof value === "number" && !Number.isFinite(value) ? String(value) : value)))
}
atomicJson("routing-termination.json", { timedOut, thrownError, routingElapsedMs,
  iterations: pipeline.iterations, solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error })
if (thrownError) console.error(`COARSE_PHASE_THROWN ${thrownError}`)
if (pipeline.solved) {
  const srjOutput = pipeline.getOutputSimpleRouteJson()
  const serialized = JSON.stringify(srjOutput)
  const compressed = gzipSync(serialized)
  assert(compressed.byteLength <= 16 * 1024 * 1024, "Solved phase output exceeded artifact scope")
  writeFileSync(join(output, "phase-output.srj.json.gz"), compressed)
  outputSummary = { sha256: sha(serialized), compressedSha256: sha(compressed), traceCount: srjOutput.traces?.length ?? null }
}
const native = JSON.parse(readFileSync(runtime.nativeCoarsePath, "utf8")).reports
  .find((report: any) => report.phase === runtime.case.phase)
assert(native?.innerHookInstalled && primaryReport?.innerHookInstalled)
const normalizeClass = (report: Record<string, any>): Record<string, any> => {
  const className = report.configured.className
  return JSON.parse(JSON.stringify(report, (key, value) => {
    if (key === "className" && value === className) return "PRIMARY_COARSE_SOLVER"
    return typeof value === "string" && value === `${className} ran out of iterations`
      ? "PRIMARY_COARSE_SOLVER ran out of iterations" : value
  }))
}
const expected = normalizeClass(native)
const actual = normalizeClass(primaryReport)
const contractFields = ["inputNetCount", "configured", "initial", "lifecycleCounts", "longestRouteEventIntervals",
  "recentRecovery", "firstRejectedGoalApproach", "firstExhaustedSearch", "firstNonfiniteGoalApproachWithoutPriorGoal",
  "finalAcceptance", "final", "innerHookInstalled"]
const baselineContract = Object.fromEntries(contractFields.map(field => [field, {
  equal: JSON.stringify(expected[field]) === JSON.stringify(actual[field]),
}]))
const baselineQualified = contractFields.every(field => baselineContract[field].equal)
const summarizeSolver = (solver: any): Record<string, unknown> => ({
  className: solver.constructor.name, iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
  solved: solver.solved, failed: solver.failed, error: solver.error, stats: structuredClone(solver.stats),
})
const result = {
  ...runtime, elapsedMs: routingElapsedMs, diagnosticFinishMs: performance.now() - started - routingElapsedMs,
  solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error, iterations: pipeline.iterations,
  timedOut, thrownError, wasmUsage, outputSummary, baselineQualified, baselineContract,
  stages: stages.map(({ name, solver, firstPipelineIteration }) => ({ name, firstPipelineIteration, ...summarizeSolver(solver) })),
  highDensity: highDensity ? { ...summarizeSolver(highDensity), lastObservedActiveNode: activeHdNode,
    acceptedNodeCount: highDensity.stats.solvedNodeCount, routeCount: highDensity.routes.length } : null,
  diagnosticObservationValid: coarseReport.observationErrors.length === 0 && Boolean(primaryReport?.innerHookInstalled),
  interpretation: "Independent native phase replay, not a full-board result. Committed coarse owners and accepted HD nodes do not measure physically connected board nets.",
}
assert.equal(sha(readFileSync(runtime.originalAutorouterEntry)), runtime.originalAutorouterSha256)
assert.equal(sha(readFileSync(runtime.selectedAutorouterEntry)), runtime.selectedAutorouterSha256)
atomicJson("result.json", result)
console.log(`COARSE_PHASE_RESULT ${JSON.stringify({ case: runtime.case.id, variant: runtime.variant,
  solved: result.solved, failed: result.failed, error: result.error, elapsedMs: result.elapsedMs,
  baselineQualified, diagnosticObservationValid: result.diagnosticObservationValid })}`)
if (timedOut || thrownError || wasmUsage.routingOrUnknownAttempts > 0 || !result.diagnosticObservationValid ||
  !["configured", "initial", "inputNetCount", "innerHookInstalled"].every(field => baselineContract[field].equal) ||
  (runtime.variant === "source-baseline" && !baselineQualified)) process.exitCode = 1
