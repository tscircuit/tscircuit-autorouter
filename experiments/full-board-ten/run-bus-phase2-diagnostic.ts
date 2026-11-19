import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

type Data = Record<string, any>
const [moduleArgument, outputArgument, manifestArgument] = process.argv.slice(2)
assert(moduleArgument && outputArgument && manifestArgument)
const modulePath = resolve(moduleArgument), output = resolve(outputArgument)
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex")
const plan = JSON.parse(readFileSync(resolve(import.meta.dir, "bus-phase2-plan.json"), "utf8"))
assert.equal(plan.qualificationReady, true)
const manifest = JSON.parse(readFileSync(manifestArgument, "utf8"))
const core = manifest.packages.find((entry: Data) => entry.name === "@tscircuit/core")
assert.equal(manifest.mainVersion, "0.0.3236")
assert.equal(core.version, "0.0.2418")
assert.equal(core.entrySha256, plan.source.candidateCoreSha256)
assert.equal(hash(readFileSync(core.entry)), core.entrySha256)
assert.equal(manifest.routingSourceOverride.sourceCandidateCommit, plan.source.sourceCandidateCommit)
assert.equal(manifest.routingSourceOverride.autorouterSourceOverride, false)
assert.equal(Bun.version, "1.4.3")
assert.equal(process.arch, "arm64")
const inputBytes = gunzipSync(readFileSync(resolve(output, "phase-2-input.srj.json.gz")))
assert.equal(hash(inputBytes), plan.input.rawSha256)
const input = JSON.parse(inputBytes.toString())
const canonicalRawInputBeforeSha256 = hash(JSON.stringify(input))
mkdirSync(output, { recursive: true })
const originalWebAssembly = globalThis.WebAssembly
const wasmAttempts: string[] = [], importWasm: string[] = []
let importing = true
const guarded = new Set(["instantiate", "instantiateStreaming", "compile", "compileStreaming", "Module", "Instance", "Memory"])
const wrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(originalWebAssembly, {
  get(target, key, receiver): unknown {
    const value = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return value
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => {
      if (importing) { if (importWasm.length < 32) importWasm.push(String(key)); return }
      wasmAttempts.push(String(key)); throw new Error(`Routing WASM is forbidden: ${String(key)}`)
    }
    const wrapped = new Proxy(value, { apply(fn, receiver, arguments_): unknown { check(); return Reflect.apply(fn, receiver, arguments_) }, construct(fn, arguments_): object { check(); return Reflect.construct(fn, arguments_) } })
    wrappers.set(key, wrapped); return wrapped
  },
})
const diagnosticEntrySha256 = hash(readFileSync(modulePath))
assert.equal(diagnosticEntrySha256, plan.source.diagnosticCoreSha256)
const exported = await import(pathToFileURL(modulePath).href)
importing = false
const Pipeline = exported.__busDiagPipeline
assert.equal(typeof Pipeline, "function")
const startedAt = performance.now()
const adapted = exported.__busDiagAdapt(input)
const adaptedBeforeSha256 = hash(JSON.stringify(adapted))
let solver: Data | null = null, lastFlush = -Infinity, checkpoints = 0
let captureDeadlineReached = false, executionError: string | null = null
let initialMaxIterations: number | null = null
function state(): Data {
  const stats = solver?.stats
  return { elapsedMs: performance.now() - startedAt, phase: solver?.phase ?? null,
    iterations: solver?.iterations ?? null, maxIterations: solver?.MAX_ITERATIONS ?? null,
    solved: solver?.solved ?? false, failed: solver?.failed ?? false, error: solver?.error ?? null,
    currentTraceCount: solver?.traces?.length ?? 0,
    stats: stats ? { phase: stats.phase, routingStage: stats.routingStage, algorithm: stats.algorithm, lane: stats.lane, totalLanes: stats.totalLanes, expandedVertices: stats.expandedVertices, failureCode: stats.failureCode, carrierStrategy: stats.carrierStrategy } : null }
}
function checkpoint(force = false): void {
  const now = performance.now()
  if (!force && now - lastFlush < 10000) return
  lastFlush = now
  const value = { ...state(), rawInputSha256: hash(inputBytes), executionError, wasmAttempts }
  writeFileSync(resolve(output, "checkpoint.json"), JSON.stringify(value) + "\n")
  if (checkpoints++ < 100) appendFileSync(resolve(output, "checkpoints.jsonl"), JSON.stringify(value) + "\n")
}
writeFileSync(resolve(output, "start-proof.json"), JSON.stringify({ rawInputSha256: hash(inputBytes), adaptedBeforeSha256,
  coreSha256: core.entrySha256, observerSha256: diagnosticEntrySha256, nativeOptions: {}, routingBudgetsChanged: false,
  externalDiagnosticWindowMs: 900000, fullBoardRemainingBudgetEquivalent: false, sourceHooks: 0 }) + "\n")
checkpoint(true)
try {
  solver = new Pipeline(adapted)
  initialMaxIterations = solver.MAX_ITERATIONS
  checkpoint(true)
  while (!solver.solved && !solver.failed) {
    for (let count = 0; count < 200 && !solver.solved && !solver.failed; count++) {
      if (performance.now() - startedAt >= 900000) { captureDeadlineReached = true; break }
      checkpoint()
      solver.step()
    }
    checkpoint()
    if (captureDeadlineReached) break
    await new Promise<void>(done => setImmediate(done))
  }
} catch (error) { executionError = String(error) }
finally {
  checkpoint(true)
  const report: Data = { scope: "One frozen3236 isolated final-phase diagnostic, superseded by latest3242. Fresh900s window; not a full-board gain or comparable performance run.",
    ...state(), mainVersion: manifest.mainVersion, coreVersion: core.version, sourceCandidateCommit: plan.source.sourceCandidateCommit,
    originalEntrySha256: core.entrySha256, diagnosticEntrySha256, rawInputSha256: hash(inputBytes),
    canonicalRawInputBeforeSha256, canonicalRawInputAfterSha256: hash(JSON.stringify(input)),
    adaptedBeforeSha256, adaptedAfterSha256: hash(JSON.stringify(adapted)), nativeOptions: {}, routingBudgetsChanged: false,
    externalDiagnosticWindowMs: 900000, fullBoardRemainingBudgetEquivalent: false, sourceHooks: 0,
    captureDeadlineReached, executionError, wasmAttempts, importWasm, initialMaxIterations,
    nativeRoutingNames: input.connections.map((connection: Data) => connection.name),
    retainedInputTraceCount: input.traces.length, acceptedOutputCaptured: false }
  if (solver?.solved && !solver.failed && executionError === null) {
    try {
      const bytes = Buffer.from(JSON.stringify(solver.getOutput()))
      writeFileSync(resolve(output, "completed-output.srj.json.gz"), gzipSync(bytes))
      Object.assign(report, { acceptedOutputCaptured: true, outputSha256: hash(bytes), outputNeedsPhysicalValidation: true })
    } catch (error) { executionError = String(error); report.executionError = executionError }
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify(report))
  globalThis.WebAssembly = originalWebAssembly
}
assert.equal(hash(readFileSync(core.entry)), core.entrySha256)
assert.equal(executionError, null)
assert.deepEqual(wasmAttempts, [])
