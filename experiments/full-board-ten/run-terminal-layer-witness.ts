import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gzipSync, gunzipSync } from "node:zlib"
import { createTerminalLayerObserver } from "./createTerminalLayerObserver"
import { createCoarseRoutingDiagnostics } from "./createCoarseRoutingDiagnostics"

const [runtimePath, output] = process.argv.slice(2)
assert(runtimePath && output, "Usage: run-terminal-layer-witness.ts RUNTIME.json OUTPUT")
mkdirSync(output, { recursive: true })
const runtime = JSON.parse(readFileSync(runtimePath, "utf8"))
const sha = (contents: string | Uint8Array): string => createHash("sha256").update(contents).digest("hex")
assert.equal(sha(readFileSync(runtime.autorouterEntry)), runtime.autorouterSha256)
const inputBytes = gunzipSync(readFileSync(runtime.inputPath))
assert.equal(sha(inputBytes), runtime.inputSha256)
const input = JSON.parse(inputBytes.toString())
const atomicJson = (name: string, value: unknown): void => {
  const target = join(output, name)
  writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2))
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

const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(pathToFileURL(runtime.autorouterEntry).href)
importingPublishedAutorouter = false
const constructorOptions = {
  capacityDepth: undefined,
  targetMinCapacity: undefined,
  cacheProvider: null,
  effort: undefined,
}
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, constructorOptions)
assert.equal(typeof pipeline.stepAsync, "undefined", "Core stepping contract changed")
const observer = createTerminalLayerObserver(pipeline)
let coarseReport: Record<string, any> | null = null
const coarseObserver = createCoarseRoutingDiagnostics({
  pipelineClass: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  registeredPipelineClass: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  targetPhase: "plane_escape",
  onSnapshot(report): void { coarseReport = report },
})
coarseObserver.onSolverStarted({
  solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  solverParams: { input, options: constructorOptions },
}, "plane_escape")
const started = performance.now()
let lastFlush = started
let timedOut = false
let thrownError: string | null = null
const checkpoint = (): void => {
  const raw = JSON.stringify(observer.getReport())
  assert(Buffer.byteLength(raw) <= runtime.diagnosticPacketLimitBytes, "Diagnostic packet exceeds declared bounded size")
  const target = join(output, "terminal-observation.json.gz")
  writeFileSync(`${target}.tmp`, gzipSync(raw, { level: 1 }))
  renameSync(`${target}.tmp`, target)
  if (coarseReport) atomicJson("coarse-diagnostics.json", { reports: [coarseReport] })
  atomicJson("progress.json", {
    diagnosticOnly: true, elapsedMs: performance.now() - started,
    solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error,
    phase: pipeline.getCurrentPhase(), iterations: pipeline.iterations, wasmUsage,
  })
}
try {
  while (!pipeline.solved && !pipeline.failed) {
    const batchStarted = performance.now()
    do {
      const previousSingle = observer.beforePipelineStep()
      pipeline.step()
      observer.afterPipelineStep(previousSingle)
      if (performance.now() - started >= 900000) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) {
      checkpoint()
      lastFlush = performance.now()
      console.log(`TERMINAL_WITNESS_PROGRESS ${JSON.stringify({ phase: pipeline.getCurrentPhase(), iterations: pipeline.iterations, elapsedMs: lastFlush - started })}`)
    }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise(resolve => setTimeout(resolve, 0))
  }
} catch (error) {
  thrownError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error).slice(0, 8000)
} finally {
  coarseReport = coarseObserver.finish()
  observer.dispose()
  globalThis.WebAssembly = nativeWasm
  checkpoint()
}
assert.equal(sha(readFileSync(runtime.autorouterEntry)), runtime.autorouterSha256)
assert.equal(sha(gunzipSync(readFileSync(runtime.inputPath))), runtime.inputSha256)
const observation = observer.getReport()
const expectedError = 'Route stitching did not reach the PCB terminal layers for "source_net_0_mst8"'
const nativeFailureReproduced = pipeline.failed && pipeline.error === expectedError
const coarse = coarseReport?.final
const nativeCoarseReproduced = coarseReport?.configured?.routeCount === 559 &&
  coarseReport?.configured?.MAX_ITERATIONS === 2000000 && coarse?.solved === true &&
  coarse.failed === false && coarse.pendingRouteCount === 0 &&
  coarse.stats.acceptedGreedyFinalRouteOnTimeout === true &&
  coarse.stats.greedyFinalRouteIter === 4 &&
  coarse.stats.greedyFinalRouteRemainingRouteCount === 60
const failedAttempt = observation.attempts.find((attempt: Record<string, any>) => attempt.steps.at(-1)?.after.failed)
const stageNames = ["highDensityForceImproveSolver", "highDensityRepairSolver", "highDensityStitchSolver"]
const stageInputsCaptured = stageNames.every(name => Array.isArray(observation.stages[name]?.rootRoutes))
const targetRouteCountsByStage = Object.fromEntries(stageNames.map(name => [name, observation.stages[name]?.rootRoutes?.filter((route: Record<string, any>) => route.connectionName === "source_net_0_mst8").length ?? null]))
const diagnosticObservationValid = nativeFailureReproduced && nativeCoarseReproduced && stageInputsCaptured &&
  Boolean(failedAttempt?.finalMerged) && !timedOut && !thrownError && wasmUsage.routingOrUnknownAttempts === 0
const result = {
  ...runtime, elapsedMs: performance.now() - started,
  solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error,
  iterations: pipeline.iterations, timedOut, thrownError, wasmUsage,
  nativeFailureReproduced, nativeCoarseReproduced, stageInputsCaptured, targetRouteCountsByStage, diagnosticObservationValid,
  failureEvidence: failedAttempt ? {
    start: failedAttempt.start, end: failedAttempt.end,
    first: failedAttempt.finalMerged?.route[0], last: failedAttempt.finalMerged?.route.at(-1),
    initialFragmentCount: failedAttempt.initialRemaining.length,
    lastStep: failedAttempt.steps.at(-1),
  } : null,
  interpretation: "Native phase diagnostic only; unchanged published solver and guards. No full-board connectivity or performance gain is measured.",
}
atomicJson("result.json", result)
console.log(`TERMINAL_WITNESS_RESULT ${JSON.stringify(result)}`)
if (!diagnosticObservationValid) process.exitCode = 1
