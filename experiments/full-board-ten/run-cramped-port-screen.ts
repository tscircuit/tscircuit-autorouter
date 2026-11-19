import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

type Data = Record<string, any>
const flags = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((rows, value, index, args) => {
  if (index % 2 === 0) rows.push([value, args[index + 1]!])
  return rows
}, []))
const allowed = ["--module", "--input", "--output", "--manifest", "--plan", "--variant"]
assert.equal(process.argv.slice(2).length % 2, 0)
assert(allowed.every(flag => flags[flag]) && Object.keys(flags).every(flag => allowed.includes(flag)))
const variant = flags["--variant"]!
assert.equal(variant, "candidate")
const planPath = resolve(flags["--plan"]!)
const planBytes = readFileSync(planPath)
const plan = JSON.parse(planBytes.toString())
assert.equal(plan.qualificationReady, true, "Screen remains held")
assert.equal(plan.captureDeadlineMs, 900000)
assert.equal(plan.hardDeadlineSeconds, 960)
const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex")
const mapBytes = readFileSync(resolve(dirname(planPath), "cramped-port-capacity-source-mapping.json"))
assert.equal(sha(mapBytes), plan.sourceCandidate.mappingSha256)
const mapping = JSON.parse(mapBytes.toString())
assert.equal(mapping.schemaVersion, 2)
assert.deepEqual(mapping.source, plan.sourceCandidate.source)
assert.equal(mapping.originalAutorouterSha256, "5695c6361c0f7a7dc26ddd1b9264b8a8c122e5f7b9610cf24c6af3b99c545df1")
assert.equal(mapping.candidateAutorouterSha256, plan.sourceCandidate.candidateAutorouterSha256)
const inputPath = resolve(flags["--input"]!)
const inputCompressed = readFileSync(inputPath)
const inputBytes = gunzipSync(inputCompressed)
assert.equal(sha(inputBytes), "010757e915e6ad2b138c2bc8dd37c43f09162490537d082957c7ae907d7a1cfd")
const input = JSON.parse(inputBytes.toString())
const inputCanonical = JSON.stringify(input)
const modulePath = resolve(flags["--module"]!)
const moduleBytes = readFileSync(modulePath)
assert.equal(sha(moduleBytes), variant === "base" ? mapping.originalAutorouterSha256 : mapping.candidateAutorouterSha256)
const manifest = JSON.parse(readFileSync(resolve(flags["--manifest"]!), "utf8"))
assert.equal(manifest.mainVersion, "0.0.3242")
assert.equal(manifest.sourceOverrides, false)
assert.deepEqual(manifest.dependencyOverrides, [])
const autorouter = manifest.packages.find((item: Data) => item.name === "@tscircuit/capacity-autorouter")
assert.equal(modulePath, variant === "base" ? autorouter.entry : resolve(dirname(autorouter.entry), "cramped-port-capacity-candidate.js"))
assert.equal(autorouter.entrySha256, mapping.originalAutorouterSha256)
assert.equal(sha(readFileSync(autorouter.entry)), mapping.originalAutorouterSha256)
assert.equal(autorouter.version, "0.0.1132")
assert.equal(Bun.version, "1.4.3")
assert.equal(process.arch, "arm64")
const outputDirectory = resolve(flags["--output"]!)
mkdirSync(outputDirectory, { recursive: true })
const write = (name: string, data: unknown): void => writeFileSync(resolve(outputDirectory, name), JSON.stringify(data, null, 2) + "\n")

// Same policy as the published phase capture; no routing WASM is allowed.
const wasmAttempts: string[] = []
const coldImportWasmCalls: string[] = []
let coldImport = true
const guarded = new Set(["instantiate", "instantiateStreaming", "compile", "compileStreaming", "Module", "Instance", "Memory"])
const wrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(globalThis.WebAssembly, {
  get(target, key, receiver): unknown {
    const value = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return value
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => {
      if (coldImport) { coldImportWasmCalls.push(String(key)); return }
      wasmAttempts.push(String(key))
      throw new Error(`Routing or unknown WASM ${String(key)} is forbidden`)
    }
    const wrapped = new Proxy(value, {
      apply(fn, thisArg, args): unknown { check(); return Reflect.apply(fn, thisArg, args) },
      construct(fn, args): object { check(); return Reflect.construct(fn, args) },
    })
    wrappers.set(key, wrapped)
    return wrapped
  },
})
const published = await import(pathToFileURL(modulePath).href)
coldImport = false
const options = { capacityDepth: undefined, targetMinCapacity: undefined, cacheProvider: null, effort: undefined }
const pipeline = new published.AutoroutingPipelineSolver9_PreloadedTraceGraph(input, options)
assert.equal(typeof pipeline.stepAsync, "undefined")
let uniformBoundary: Data | null = null
let retainedRegional: any = null
let retainedRegionalContext: Data | null = null

function inspectUniformBoundary(): void {
  const uniform = pipeline.uniformPortDistributionSolver
  if (uniformBoundary || !uniform?.solved) return
  assert.equal(pipeline.activeSubSolver, null)
  assert.equal(pipeline.getCurrentPhase(), "highDensityRouteSolver")
  assert.equal(pipeline.highDensityRouteSolver, undefined)
  const nodesSha256 = sha(JSON.stringify(uniform.redistributedNodes))
  uniformBoundary = { nodesSha256, nodeCount: uniform.redistributedNodes.length, pointInterventionApplied: false }
}

// Retain only references to this regional problem before the parent clears its
// maps. Projection and serialization happen after the native loop terminates.
function retainRegionalContext(regional: any, parent: any): Data {
  const own = (object: any, key: string): any => object == null ? undefined : Object.getOwnPropertyDescriptor(object, key)?.value
  const sections = own(parent, "activeFallbackFixedRouteSections")
  const promoted = own(parent, "activeFallbackPromotedFixedRouteConnectionNames")
  return {
    regional,
    originalNode: own(parent, "activeNode"),
    sections: sections instanceof Map ? [...sections.entries()] : [],
    promotedNames: promoted instanceof Set ? [...promoted] : [],
    fixedObstacleRoutes: own(parent, "activeFallbackFixedObstacleRoutes"),
  }
}

function summarizeRegionalContext(context: Data | null): Data {
  const own = (object: any, key: string): any => object == null ? undefined : Object.getOwnPropertyDescriptor(object, key)?.value
  if (!context) return { captured: false, scope: "No native regional instance was observed" }
  const regional = context.regional
  const params = own(regional, "params")
  const settings: Data = {}
  for (const key of ["viaDiameter", "traceWidth", "obstacleMargin", "minClearance", "viaCopperClearance", "viaToPadClearance", "layerCount", "allowBlindAndBuriedVias", "effort"]) settings[key] = own(params, key)
  const stats: Data = {}
  const ownStats = own(regional, "stats")
  if (ownStats) for (const key of Object.keys(ownStats)) {
    const value = own(ownStats, key)
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string" || value === null) stats[key] = value
  }
  const blobs: Data = {}
  const fields: Data = {}
  let retainedBytes = 0
  // Preserve the node and local sections first. Bulky optional arrays retain
  // only their identity/count when the shared 512KiB observation bound fills.
  const values: Data = {
    regionalNode: own(params, "nodeWithPortPoints"), originalNode: context.originalNode,
    fixedRouteSections: context.sections, promotedNames: context.promotedNames,
    validatedRoutes: own(regional, "validatedRoutes"),
    rawHighDensityRoutes: own(own(regional, "highDensitySolver"), "routes"),
    fixedObstacleRoutes: context.fixedObstacleRoutes,
  }
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) { fields[name] = { present: false }; continue }
    const text = JSON.stringify(value)
    const bytes = Buffer.byteLength(text)
    const digest = sha(text)
    const saved = Boolean(blobs[digest]) || retainedBytes + bytes <= 524288
    fields[name] = { present: true, sha256: digest, bytes, count: Array.isArray(value) ? value.length : null, retained: saved }
    if (saved && !blobs[digest]) { blobs[digest] = JSON.parse(text); retainedBytes += bytes }
  }
  const node = own(params, "nodeWithPortPoints")
  const obstacles = own(params, "obstacles")
  const boardObstacles = own(params, "boardObstacles")
  return {
    captured: true, nodeId: own(node, "capacityMeshNodeId") ?? null,
    solved: own(regional, "solved") ?? null, failed: own(regional, "failed") ?? null,
    error: typeof own(regional, "error") === "string" ? own(regional, "error").slice(0, 2048) : null,
    settings, stats, fields, blobs, retainedBytes, maximumBlobBytes: 524288,
    constructorObstacleCount: Array.isArray(obstacles) ? obstacles.length : null,
    constructorObstacleSha256: Array.isArray(obstacles) ? sha(JSON.stringify(obstacles)) : null,
    originalBoardObstacleCount: Array.isArray(boardObstacles) ? boardObstacles.length : null,
    originalBoardObstacleSha256: Array.isArray(boardObstacles) ? sha(JSON.stringify(boardObstacles)) : null,
    fullConstructorCaptured: false, acceptedPipelineOutput: false,
    scope: "Latest retained regional own data; it may be an earlier region if the phase stops elsewhere. Node, local clipped sections and selected route arrays are diagnostic only. Complete board/constructor obstacle arrays and solver search state are excluded; native input remains authenticated separately. No solver methods are called.",
  }
}

const started = performance.now()
let lastFlush = started
let lastPhase: string | undefined
const phaseTransitions: Data[] = []
let timedOut = false
let thrownError: string | null = null
let outputSha256: string | null = null
const state = (): Data => ({
  solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error,
  iterations: pipeline.iterations, MAX_ITERATIONS: pipeline.MAX_ITERATIONS,
  activePhase: pipeline.getCurrentPhase(), elapsedMs: performance.now() - started,
  highDensity: pipeline.highDensityRouteSolver ? {
    solved: pipeline.highDensityRouteSolver.solved, failed: pipeline.highDensityRouteSolver.failed,
    error: pipeline.highDensityRouteSolver.error, iterations: pipeline.highDensityRouteSolver.iterations,
    stats: pipeline.highDensityRouteSolver.stats,
  } : null,
})
try {
  while (!pipeline.solved && !pipeline.failed) {
    const batchStarted = performance.now()
    do {
      const regional = pipeline.highDensityRouteSolver?.activeFallbackSolver
      if (regional && regional !== retainedRegional) {
        retainedRegional = regional
        retainedRegionalContext = retainRegionalContext(regional, pipeline.highDensityRouteSolver)
      }
      pipeline.step()
      inspectUniformBoundary()
      const phase = pipeline.getCurrentPhase()
      if (phase !== lastPhase) {
        phaseTransitions.push({ phase, elapsedMs: performance.now() - started, iterations: pipeline.iterations })
        lastPhase = phase
      }
      if (performance.now() - started >= plan.captureDeadlineMs) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) {
      write("progress.json", state())
      lastFlush = performance.now()
    }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise<void>(done => setTimeout(done, 0))
  }
  if (pipeline.solved && !pipeline.failed && !timedOut) {
    assert(uniformBoundary, "Full phase solved without the original Uniform boundary")
    const output = JSON.stringify(pipeline.getOutputSimpleRouteJson())
    outputSha256 = sha(output)
    writeFileSync(resolve(outputDirectory, "phase-output.srj.json.gz"), gzipSync(output))
  }
} catch (error) {
  thrownError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error)
}
const terminalState = state()
const report: Data = {
  schemaVersion: 1, variant, ...terminalState, timedOut, thrownError, outputSha256,
  inputSha256: sha(inputBytes), inputCompressedSha256: sha(inputCompressed),
  initialInputCanonicalSha256: sha(inputCanonical), finalInputCanonicalSha256: sha(JSON.stringify(input)),
  inputFileUnchanged: sha(readFileSync(inputPath)) === sha(inputCompressed),
  autorouterEntrySha256: sha(moduleBytes), autorouterEntryUnchanged: sha(readFileSync(modulePath)) === sha(moduleBytes),
  publishedAutorouterEntryUnchanged: sha(readFileSync(autorouter.entry)) === mapping.originalAutorouterSha256,
  planSha256: sha(planBytes), mappingSha256: sha(mapBytes), sourceCandidate: mapping.source,
  suppliedOptions: { cacheProvider: null }, undefinedOptionKeys: ["capacityDepth", "targetMinCapacity", "effort"],
  effectiveOptions: pipeline.opts, effectiveEffort: pipeline.effort,
  captureDeadlineMs: plan.captureDeadlineMs, hardDeadlineSeconds: plan.hardDeadlineSeconds,
  uniformBoundary, regionalContextSha256: null, regionalObservationErrors: [], phaseTransitions, wasmAttempts, coldImportWasmCalls,
  scope: "Single Tiny cramped-port guard source comparison on unchanged native iMX6 phase4. Published control is authenticated prior run44458267851. A fresh900s phase solve is diagnostic only; all native demands/physical assessment and an actual fullboard900s rerun are required before any fullboard gain claim.",
}
write("report.json", report)
const currentRegional = pipeline.highDensityRouteSolver?.activeFallbackSolver
if (currentRegional && currentRegional !== retainedRegional) retainedRegionalContext = retainRegionalContext(currentRegional, pipeline.highDensityRouteSolver)
try {
  const regionalContext = summarizeRegionalContext(retainedRegionalContext)
  const bytes = JSON.stringify(regionalContext) + "\n"
  assert(Buffer.byteLength(bytes) <= 540672)
  writeFileSync(resolve(outputDirectory, "regional-context.json"), bytes)
  report.regionalContextSha256 = sha(bytes)
} catch (error) {
  report.regionalObservationErrors.push({ capture: "regional-context", error: String(error).slice(0, 2048) })
}

write("report.json", report)
console.log(JSON.stringify({ variant, solved: report.solved, failed: report.failed, error: report.error, timedOut, thrownError, outputSha256, elapsedMs: report.elapsedMs }))
if (thrownError || wasmAttempts.length || !report.inputFileUnchanged || !report.autorouterEntryUnchanged || !report.publishedAutorouterEntryUnchanged || report.initialInputCanonicalSha256 !== report.finalInputCanonicalSha256) process.exitCode = 1
