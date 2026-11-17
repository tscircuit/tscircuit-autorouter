import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gzipSync, gunzipSync } from "node:zlib"
import { createHighDensityPhaseObserver } from "./createHighDensityPhaseObserver"
import { createViaReservationObserver } from "./createViaReservationObserver"

const [runtimePath, output] = process.argv.slice(2)
assert(runtimePath && output, "Usage: run-phase-replay.ts RUNTIME.json OUTPUT")
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
// Exact constructor used by frozen Core's auto-local phase solver.
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
  capacityDepth: undefined,
  targetMinCapacity: undefined,
  cacheProvider: null,
  effort: undefined,
})
assert.equal(typeof pipeline.stepAsync, "undefined", "Core stepping contract changed")
const observer = createHighDensityPhaseObserver({})
const viaObserver = createViaReservationObserver()
const started = performance.now()
let lastFlush = started
let timedOut = false
let thrownError: string | null = null
let outputSummary: Record<string, unknown> | null = null
const checkpoint = (): void => {
  atomicJson("phase-observation.json", observer.getReport())
  atomicJson("via-reservation-observation.json", viaObserver.getReport())
  atomicJson("progress.json", {
    variant: runtime.variant, elapsedMs: performance.now() - started,
    solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error,
    iterations: pipeline.iterations, wasmUsage,
  })
}
try {
  observer.afterPipelineStep(pipeline)
  viaObserver.afterPipelineStep(pipeline)
  while (!pipeline.solved && !pipeline.failed) {
    const batchStarted = performance.now()
    do {
      pipeline.step()
      observer.afterPipelineStep(pipeline)
      viaObserver.afterPipelineStep(pipeline)
      if (performance.now() - started >= 900000) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) {
      checkpoint()
      lastFlush = performance.now()
      console.log(`HD_PHASE_PROGRESS ${JSON.stringify({ variant: runtime.variant, iterations: pipeline.iterations, elapsedMs: lastFlush - started, solved: pipeline.solved, failed: pipeline.failed })}`)
    }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise(resolve => setTimeout(resolve, 0))
  }
  if (pipeline.solved) {
    const srjOutput = pipeline.getOutput()
    const serialized = JSON.stringify(srjOutput)
    writeFileSync(join(output, "phase-output.srj.json.gz"), gzipSync(serialized))
    outputSummary = { sha256: sha(serialized), traceCount: srjOutput.traces?.length ?? null }
  }
} catch (error) {
  thrownError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error).slice(0, 8000)
} finally {
  observer.finish(pipeline)
  observer.dispose()
  globalThis.WebAssembly = nativeWasm
  checkpoint()
}
assert.equal(sha(readFileSync(runtime.originalAutorouterEntry)), runtime.originalAutorouterSha256)
assert.equal(sha(readFileSync(runtime.selectedAutorouterEntry)), runtime.selectedAutorouterSha256)
const observation = observer.getReport()
const tinySegments = observation.targetTinyContext?.segments ?? []
const vrefSegments = tinySegments.filter((segment: { metadata: { connectionId?: string } }) =>
  ["source_net_34_mst0", "source_net_34_mst6"].includes(segment.metadata.connectionId ?? ""))
const preloadSegments = tinySegments.filter((segment: { metadata: { preloadedTraceSection?: { traceId?: string } } }) =>
  segment.metadata.preloadedTraceSection?.traceId === "source_net_20_0")
const nativeTinyRolesReproduced = tinySegments.length === 3 && vrefSegments.length === 2 && preloadSegments.length === 1 &&
  vrefSegments.every((segment: { numericNet: number; fromZ: number; toZ: number; routeIsFixed: number }) =>
    segment.numericNet === vrefSegments[0].numericNet && segment.fromZ === 3 && segment.toZ === 0 && segment.routeIsFixed === 0) &&
  preloadSegments[0].numericNet !== vrefSegments[0].numericNet && preloadSegments[0].fromZ === 1 && preloadSegments[0].toZ === 0 &&
  preloadSegments[0].routeIsFixed === 0
const viaObservation = viaObserver.getReport()
const originalVia = viaObservation.originalSerialized?.nativeVias?.[0]
const activeNativeReservation = viaObservation.firstNumeric?.targetReservations?.find((reservation: any) =>
  reservation.metadata.preloadedTraceSection?.traceId === "source_net_20_0" &&
  Math.abs(reservation.center.x - 21.33) < 1e-9 &&
  Math.abs(reservation.center.y - 18.186797048414103) < 1e-9 &&
  reservation.diameter === 0.45 && reservation.z1 === 0 && reservation.z2 === 3)
const nativeReservationActivated = viaObservation.originalSerialized?.rawViaCount === 92 &&
  viaObservation.originalSerialized?.nativeVias?.length === 1 && originalVia?.routePosition === 55 &&
  viaObservation.originalSerialized?.targetReservations?.length === 1 && Boolean(activeNativeReservation)
const result = {
  ...runtime, elapsedMs: performance.now() - started,
  solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error,
  iterations: pipeline.iterations, timedOut, thrownError, outputSummary, wasmUsage,
  nativeFailureReproduced: pipeline.failed && String(pipeline.error).includes("topology_merge_17108"),
  nativeTinyRolesReproduced, nativeReservationActivated,
  diagnosticObservationValid: observation.observationErrors.length === 0 && viaObserver.getReport().observationErrors.length === 0 &&
    Boolean(viaObserver.getReport().originalSerialized) && Boolean(viaObserver.getReport().firstNumeric) &&
    (runtime.variant === "via-reservation" ? nativeReservationActivated : (Boolean(observation.queue) && nativeTinyRolesReproduced)),
  interpretation: "Phase diagnostic only. Compare baseline constructor, target Tiny state and failure with the full native run before using candidate node history. No full-board connectivity gain is measured here.",
}
atomicJson("result.json", result)
console.log(`HD_PHASE_RESULT ${JSON.stringify({ variant: runtime.variant, solved: result.solved, failed: result.failed, error: result.error, timedOut, thrownError, nativeFailureReproduced: result.nativeFailureReproduced, elapsedMs: result.elapsedMs })}`)
if (timedOut || thrownError || wasmUsage.routingOrUnknownAttempts > 0 || !result.diagnosticObservationValid ||
    (runtime.variant === "source-baseline" && !result.nativeFailureReproduced)) process.exitCode = 1
