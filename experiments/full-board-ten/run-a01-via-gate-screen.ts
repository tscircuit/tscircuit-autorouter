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
assert(["base", "candidate"].includes(variant))
const planPath = resolve(flags["--plan"]!)
const planBytes = readFileSync(planPath)
const plan = JSON.parse(planBytes.toString())
assert.equal(plan.qualificationReady, true, "Screen remains held")
assert.equal(plan.captureDeadlineMs, 900000)
assert.equal(plan.hardDeadlineSeconds, 960)
const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex")
const mapBytes = readFileSync(resolve(dirname(planPath), "a01-via-gate-source-mapping.json"))
assert.equal(sha(mapBytes), plan.sourceCandidate.mappingSha256)
const mapping = JSON.parse(mapBytes.toString())
assert.equal(mapping.schemaVersion, 2)
assert.deepEqual(mapping.source, plan.sourceCandidate.source)
assert.equal(mapping.originalAutorouterSha256, "5695c6361c0f7a7dc26ddd1b9264b8a8c122e5f7b9610cf24c6af3b99c545df1")
assert.equal(mapping.candidateAutorouterSha256, plan.sourceCandidate.candidateAutorouterSha256)
const inputPath = resolve(flags["--input"]!)
const inputCompressed = readFileSync(inputPath)
const inputBytes = gunzipSync(inputCompressed)
assert.equal(sha(inputBytes), "948b9a36ed10b2132947dd6d5fe0a2132b99ccb341be1698f8b509fd9a63608c")
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
assert.equal(modulePath, variant === "base" ? autorouter.entry : resolve(dirname(autorouter.entry), "a01-via-gate-candidate.js"))
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

function inspectUniformBoundary(): void {
  const uniform = pipeline.uniformPortDistributionSolver
  if (uniformBoundary || !uniform?.solved) return
  assert.equal(pipeline.activeSubSolver, null)
  assert.equal(pipeline.getCurrentPhase(), "highDensityRouteSolver")
  assert.equal(pipeline.highDensityRouteSolver, undefined)
  const nodesSha256 = sha(JSON.stringify(uniform.redistributedNodes))
  assert.equal(nodesSha256, "3b09172791c694b7888fa990e2953398e6a26b757fbbcbc68d754b6bddbdfded")
  uniformBoundary = { nodesSha256, nodeCount: uniform.redistributedNodes.length, pointInterventionApplied: false }
}

// This reads retained data only after the native loop has stopped. It never
// calls solver methods or copies routes, constructor inputs or obstacle arrays.
function summarizeRegionalTree(regional: any): Data {
  // The native portfolio can place 68 candidates before A01, then A03/A13
  // and adaptive A01 seeds. Keep that complete portfolio within this snapshot.
  const limits = { nodes: 1024, childrenPerField: 128, routesPerSolver: 32, bytes: 524288 }
  const rows: Data[] = []
  const seen = new Map<object, number>()
  let retainedBytes = 0
  let truncated = false
  const own = (object: any, key: string): any => object == null ? undefined : Object.getOwnPropertyDescriptor(object, key)?.value
  const point = (value: any): Data | null => {
    if (!value || typeof value !== "object") return null
    const result: Data = {}
    for (const key of ["x", "y", "z", "connectionName", "rootConnectionName"]) {
      const item = own(value, key)
      if (typeof item === "number" || typeof item === "string") result[key] = item
    }
    return result
  }
  const queue: Data[] = regional ? [{ solver: regional, parentId: null, edge: "retainedRegional" }] : []
  const targetQueue: Data[] = []
  let cursor = 0
  let targetCursor = 0
  while (cursor < queue.length || targetCursor < targetQueue.length) {
    const { solver, parentId, edge, hyperParameters } = targetCursor < targetQueue.length ? targetQueue[targetCursor++]! : queue[cursor++]!
    if (!solver || typeof solver !== "object") continue
    if (seen.has(solver)) continue
    if (rows.length >= limits.nodes) { truncated = true; break }
    const id = rows.length
    const row: Data = { id, parentId, edge, constructorName: Object.getPrototypeOf(solver)?.constructor?.name ?? null }
    if (hyperParameters) row.hyperParameters = hyperParameters
    for (const key of ["solved", "failed", "iterations", "MAX_ITERATIONS", "scaleFactor", "round", "routedCount", "conflictCount", "activeConnId", "activeConnectionIndex", "connectionName", "rootConnectionName", "error"]) {
      const value = own(solver, key)
      if (typeof value === "string") { row[key] = value.slice(0, 2048); if (value.length > 2048) truncated = true }
      else if (typeof value === "number" || typeof value === "boolean" || value === null) row[key] = value
    }
    const node = own(solver, "nodeWithPortPoints") ?? own(own(solver, "params"), "nodeWithPortPoints")
    row.nodeId = own(node, "capacityMeshNodeId") ?? null
    for (const key of ["A", "B"]) if (own(solver, key)) row[key] = point(own(solver, key))
    const segment = own(solver, "activeConnSeg")
    const names = own(solver, "connIdToName")
    if (segment) row.activeSegment = { connectionName: names?.[own(segment, "connId")] ?? null, start: point(own(segment, "startPoint")), end: point(own(segment, "endPoint")) }
    const activeIndex = own(solver, "activeConnectionIndex")
    const connections = own(solver, "connections")
    if (Number.isInteger(activeIndex) && Array.isArray(connections) && connections[activeIndex]) row.activeConnection = { start: point(own(connections[activeIndex], "start")), end: point(own(connections[activeIndex], "end")) }
    const unsolved = own(solver, "unsolvedSegs")
    if (Array.isArray(unsolved)) {
      row.unsolvedSegmentCount = unsolved.length
      row.unsolvedSegmentNames = unsolved.slice(0, limits.routesPerSolver).map(segment => names?.[own(segment, "connId")] ?? null)
      if (unsolved.length > limits.routesPerSolver) truncated = true
    }
    const routes = own(solver, "solvedRoutes")
    if (routes instanceof Map) {
      row.solvedConnectionCount = routes.size
      row.solvedRouteSummaries = []
      for (const [connectionId, segments] of routes) {
        if (!Array.isArray(segments)) continue
        for (const route of segments) {
          if (row.solvedRouteSummaries.length >= limits.routesPerSolver) { truncated = true; break }
          const cells = own(route, "cells"), states = own(route, "states")
          row.solvedRouteSummaries.push({ connectionName: names?.[connectionId] ?? null, cellCount: cells?.length ?? states?.length ?? null, start: point(own(route, "startPoint")), end: point(own(route, "endPoint")) })
        }
      }
    } else if (Array.isArray(routes)) row.solvedRouteCount = routes.length
    const bytes = Buffer.byteLength(JSON.stringify(row))
    if (retainedBytes + bytes > limits.bytes - 4096) { truncated = true; break }
    retainedBytes += bytes
    seen.set(solver, id)
    rows.push(row)
    // Prefer the supervised edge when it aliases activeSubSolver, preserving
    // the candidate's flags while still visiting each retained object once.
    for (const key of ["supervisedSolvers", "failedSolvers", "failedSubSolvers"]) {
      const children = own(solver, key)
      if (!Array.isArray(children)) continue
      if (children.length > limits.childrenPerField) truncated = true
      children.slice(0, limits.childrenPerField).forEach((child, index) => {
        const flags: Data = {}
        const parameters = key === "supervisedSolvers" ? own(child, "hyperParameters") : null
        if (parameters) for (const name of Object.keys(parameters)) {
          const value = own(parameters, name)
          if (typeof value === "number" || typeof value === "boolean") flags[name] = value
        }
        const entry = { solver: key === "supervisedSolvers" ? own(child, "solver") : child, parentId: id, edge: `${key}[${index}]`, hyperParameters: flags }
        // Prioritize retained target metadata in this post-loop snapshot only.
        // Native candidate arrays and their execution order are never changed.
        if (flags.HIGH_DENSITY_A01 || flags.HIGH_DENSITY_A03) targetQueue.push(entry)
        else queue.push(entry)
      })
    }
    for (const key of ["highDensitySolver", "activeSubSolver"]) {
      const child = own(solver, key)
      if (child && typeof child === "object") queue.push({ solver: child, parentId: id, edge: key })
    }
  }
  return { captured: regional !== null, captureKind: "latestRetainedRegional", retainedNodeId: own(own(own(regional, "params"), "nodeWithPortPoints"), "capacityMeshNodeId") ?? null, retainedSolved: own(regional, "solved") ?? null, retainedFailed: own(regional, "failed") ?? null, knownBaselineNode: "cmn_162", nativeTerminalReached: pipeline.solved || pipeline.failed, limits, retainedBytes, truncated, prioritizedCandidateMetadata: ["HIGH_DENSITY_A01", "HIGH_DENSITY_A03"], rows, missingIdentityIsUnknown: true, scope: "Latest regional reference retained before parent clear; it may be a completed region if failure happened elsewhere. Post-loop own-data reads only. Temporary/discarded leaf state cannot be recovered; missing names are unknown. No solver method calls or constructor/route/obstacle arrays." }
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
      if (regional) retainedRegional = regional
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
let regionalTree: Data
try {
  regionalTree = summarizeRegionalTree(retainedRegional)
  assert(Buffer.byteLength(JSON.stringify(regionalTree) + "\n") <= regionalTree.limits.bytes)
} catch (error) {
  regionalTree = { captured: false, observationError: String(error).slice(0, 2048), nativeTerminalStatePreserved: true, scope: "Post-loop optional observation failed; this does not change the saved native outcome." }
}
const regionalTreeBytes = JSON.stringify(regionalTree) + "\n"
writeFileSync(resolve(outputDirectory, "regional-tree.json"), regionalTreeBytes)
const report = {
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
  uniformBoundary, regionalTreeSha256: sha(regionalTreeBytes), phaseTransitions, wasmAttempts, coldImportWasmCalls,
  scope: "A01 regional via-legality source comparison on the full unchanged native phase. No endpoint or Uniform intervention; a solved phase still requires all native demands and physical assessment before any benefit claim.",
}
write("report.json", report)
console.log(JSON.stringify({ variant, solved: report.solved, failed: report.failed, error: report.error, timedOut, thrownError, outputSha256, elapsedMs: report.elapsedMs }))
if (thrownError || wasmAttempts.length || !report.inputFileUnchanged || !report.autorouterEntryUnchanged || !report.publishedAutorouterEntryUnchanged || report.initialInputCanonicalSha256 !== report.finalInputCanonicalSha256) process.exitCode = 1
