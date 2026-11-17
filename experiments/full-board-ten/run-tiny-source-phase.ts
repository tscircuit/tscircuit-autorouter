import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gzipSync, gunzipSync } from "node:zlib"
import { createCoarseRoutingDiagnostics } from "./createCoarseRoutingDiagnostics"
import { createCoarseFailureDiagnostics } from "./createCoarseFailureDiagnostics"

type RuntimeObject = Record<string, any>

const [runtimePath, output] = process.argv.slice(2)
assert(runtimePath && output, "Expected PHASE_RUNTIME.json OUTPUT")
assert.equal(Bun.version, "1.4.3")
mkdirSync(output, { recursive: true })
const runtime = JSON.parse(readFileSync(runtimePath, "utf8"))
const targetPhase = runtime.targetPhase ?? "other_signals"
assert(["other_signals", "plane_escape"].includes(targetPhase))
const captureSelectedPaths = targetPhase === "other_signals"
const sha = (bytes: string | Buffer): string => createHash("sha256").update(typeof bytes === "string" ? bytes : new Uint8Array(bytes)).digest("hex")
assert.equal(sha(readFileSync(runtime.selectedAutorouterEntry)), runtime.selectedAutorouterSha256)
assert.equal(runtime.captureDeadlineMs, 900000)
assert.equal(runtime.hardDeadlineMs, 960000)
const inputBytes = gunzipSync(new Uint8Array(readFileSync(runtime.inputPath)))
assert.equal(sha(inputBytes), runtime.inputSha256)
const input = JSON.parse(inputBytes.toString())
const atomicJson = (name: string, report: unknown): void => {
  const target = join(output, name)
  writeFileSync(`${target}.tmp`, JSON.stringify(report, null, 2))
  renameSync(`${target}.tmp`, target)
}

// Identical no-routing-WASM policy to the frozen full-board worker.
const wasmUsage = { coldImportCalls: 0, geometryCalls: 0, routingOrUnknownAttempts: 0 }
let importingAutorouter = true
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
      if (importingAutorouter) { wasmUsage.coldImportCalls++; return }
      const stack = new Error().stack ?? ""
      if (!geometryModuleOrigins.some(origin => stack.includes(origin)) || /krt-wasm|krt_wasm/i.test(stack)) {
        wasmUsage.routingOrUnknownAttempts++
        throw new Error("Routing or unknown WebAssembly is disabled")
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

const { AutoroutingPipelineSolver9_PreloadedTraceGraph: Pipeline9 } = await import(pathToFileURL(runtime.selectedAutorouterEntry).href)
importingAutorouter = false
const pipeline = new Pipeline9(input, {
  capacityDepth: undefined,
  targetMinCapacity: undefined,
  cacheProvider: null,
  effort: undefined,
})
assert.equal(typeof pipeline.stepAsync, "undefined")
let coarseReport: RuntimeObject | null = null
let pathReport: RuntimeObject | null = null
const common = { pipelineClass: Pipeline9, registeredPipelineClass: Pipeline9, targetPhase }
const coarse = createCoarseRoutingDiagnostics({ ...common, onSnapshot: report => { coarseReport = report } })
const path = captureSelectedPaths ? createCoarseFailureDiagnostics({ ...common, onSnapshot: report => { pathReport = report } }) : undefined
const event = { solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", solverParams: { input } }
coarse.onSolverStarted(event, targetPhase)
path?.onSolverStarted(event, targetPhase)
const started = performance.now()
let lastFlush = started
let timedOut = false
let thrownError: string | null = null
let outputSummary: RuntimeObject | null = null
const checkpoint = (): void => {
  atomicJson("coarse-diagnostics.json", { reports: coarseReport ? [coarseReport] : [] })
  if (captureSelectedPaths) atomicJson("path-witness.json", pathReport)
  atomicJson("progress.json", { variant: runtime.variant, elapsedMs: performance.now() - started, solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error, iterations: pipeline.iterations, wasmUsage })
}
try {
  while (!pipeline.solved && !pipeline.failed) {
    const batchStarted = performance.now()
    do {
      pipeline.step()
      if (performance.now() - started >= runtime.captureDeadlineMs) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) {
      checkpoint()
      lastFlush = performance.now()
      console.log(`NATIVE_PHASE_PROGRESS ${JSON.stringify({ variant: runtime.variant, iterations: pipeline.iterations, elapsedMs: lastFlush - started })}`)
    }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise(resolve => setTimeout(resolve, 0))
  }
  if (pipeline.solved) {
    const srjOutput = pipeline.getOutput()
    const bytes = JSON.stringify(srjOutput)
    writeFileSync(join(output, "phase-output.srj.json.gz"), new Uint8Array(gzipSync(bytes)))
    outputSummary = { sha256: sha(bytes), traceCount: srjOutput.traces?.length ?? null }
  }
} catch (error) {
  thrownError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error).slice(0, 8000)
} finally {
  pathReport = path?.finish() ?? null
  coarseReport = coarse.finish()
  globalThis.WebAssembly = nativeWasm
  checkpoint()
}
assert.equal(sha(readFileSync(runtime.originalAutorouterEntry)), runtime.originalAutorouterSha256)
assert.equal(sha(readFileSync(runtime.selectedAutorouterEntry)), runtime.selectedAutorouterSha256)
const result = { ...runtime, elapsedMs: performance.now() - started, solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error, iterations: pipeline.iterations, timedOut, thrownError, outputSummary, wasmUsage }
atomicJson("result.json", result)
console.log(`NATIVE_PHASE_RESULT ${JSON.stringify(result)}`)
if (timedOut || thrownError || wasmUsage.routingOrUnknownAttempts > 0) process.exitCode = 1
