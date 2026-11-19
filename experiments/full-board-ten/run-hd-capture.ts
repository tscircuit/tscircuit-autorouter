import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

// Diagnostic only: observe the published solver's ordinary synchronous steps.
// No production methods, budgets, geometry, ordering, or results are replaced.
type RuntimeObject = Record<string, any>

const flags = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((entries, value, index, args) => {
    if (index % 2 === 0) entries.push([value, args[index + 1]!])
    return entries
  }, []),
)
const allowedFlags = ["--module", "--input", "--output", "--root", "--manifest", "--plan"]
assert.equal(process.argv.slice(2).length % 2, 0, "Expected flag/value pairs")
assert(Object.keys(flags).every((flag) => allowedFlags.includes(flag)), "Unknown diagnostic flag")
for (const flag of allowedFlags) {
  assert(flags[flag], `Missing ${flag}`)
}
const modulePath = resolve(flags["--module"]!)
const inputPath = resolve(flags["--input"]!)
const outputDirectory = resolve(flags["--output"]!)
const targetRoot = flags["--root"]!
const planBytes = readFileSync(resolve(flags["--plan"]!))
const plan = JSON.parse(planBytes.toString())
assert.equal(plan.qualificationReady, true, "Diagnostic controller remains held")
assert.equal(plan.captureDeadlineMs, 900000)
assert.equal(plan.hardDeadlineSeconds, 960)
const deadlineMs = plan.captureDeadlineMs
const primaryTargetConnection = "source_net_1_mst0"
const fallbackTargetNode = "cmn_162"
assert.equal(targetRoot, "source_net_1")
assert.equal(plan.cases.h616.primaryTargetConnection, primaryTargetConnection)
assert.equal(plan.cases.h616.fallbackTargetNode, fallbackTargetNode)
mkdirSync(outputDirectory, { recursive: true })

const sha = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex")
const entryBytes = readFileSync(modulePath)
const runtimeManifest = JSON.parse(readFileSync(resolve(flags["--manifest"]!), "utf8"))
const publishedAutorouter = runtimeManifest.packages.find((entry: RuntimeObject) => entry.name === "@tscircuit/capacity-autorouter")
assert.equal(runtimeManifest.mainVersion, "0.0.3242")
assert.equal(runtimeManifest.sourceOverrides, false)
assert.equal(runtimeManifest.dependencyOverrides.length, 0)
assert.equal(publishedAutorouter.version, "0.0.1132")
assert.equal(publishedAutorouter.entry, modulePath)
assert.equal(publishedAutorouter.entrySha256, sha(entryBytes))
assert.equal(sha(entryBytes), "5695c6361c0f7a7dc26ddd1b9264b8a8c122e5f7b9610cf24c6af3b99c545df1")
const publishedCore = runtimeManifest.packages.find((entry: RuntimeObject) => entry.name === "@tscircuit/core")
assert.equal(publishedCore.version, "0.0.2424")
assert.equal(publishedCore.entrySha256, "f8122fb04b46cb37bf48de0f8642044bc8360937a03630e4655112cc8694471b")
assert.equal(sha(readFileSync(publishedCore.entry)), publishedCore.entrySha256)
assert.equal(Bun.version, "1.4.3")
assert.equal(process.arch, "arm64")
const compressedInput = readFileSync(inputPath)
const inputBytes = inputPath.endsWith(".gz")
  ? gunzipSync(compressedInput)
  : compressedInput
assert.equal(sha(inputBytes), "948b9a36ed10b2132947dd6d5fe0a2132b99ccb341be1698f8b509fd9a63608c")
const input = JSON.parse(inputBytes.toString())
assert.equal(input.connections.length, 56)
assert.equal(input.connections.reduce((sum: number, connection: RuntimeObject) => sum + connection.pointsToConnect.length, 0), 143)
assert.equal(input.obstacles.length, 1695)
assert.equal(input.traces.length, 41)
const initialInputCanonicalSha256 = sha(JSON.stringify(input))
assert.equal(
  input.connections.filter((connection: RuntimeObject) => connection.name === targetRoot).length,
  1,
  "Expected one exact native target connection",
)

const wasmAttempts: string[] = []
const coldImportWasmCalls: RuntimeObject[] = []
let coldPublishedImport = true
const guardedWasm = new Set(["instantiate", "instantiateStreaming", "compile", "compileStreaming", "Module", "Instance", "Memory"])
const wasmWrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(globalThis.WebAssembly, {
  get(target, key, receiver): unknown {
    const value = Reflect.get(target, key, receiver)
    if (!guardedWasm.has(String(key))) return value
    if (wasmWrappers.has(key)) return wasmWrappers.get(key)
    const check = (): void => {
      if (coldPublishedImport) {
        coldImportWasmCalls.push({ method: String(key), stack: new Error().stack })
        return
      }
      wasmAttempts.push(String(key))
      throw new Error(`Routing or unknown WASM ${String(key)} is forbidden`)
    }
    const wrapped = new Proxy(value, {
      apply(fn, thisArg, args): unknown { check(); return Reflect.apply(fn, thisArg, args) },
      construct(fn, args): object { check(); return Reflect.construct(fn, args) },
    })
    wasmWrappers.set(key, wrapped)
    return wrapped
  },
})
const published = await import(pathToFileURL(modulePath).href)
coldPublishedImport = false
const Pipeline = published.AutoroutingPipelineSolver9_PreloadedTraceGraph
assert.equal(typeof Pipeline, "function", "Published Pipeline9 export is missing")
// These are the exact options supplied by Core for the authentic board phase.
const options = {
  capacityDepth: undefined,
  targetMinCapacity: undefined,
  cacheProvider: null,
  effort: undefined,
}
const pipeline = new Pipeline(input, options)
assert.equal(typeof pipeline.step, "function")
assert.equal(typeof pipeline.stepAsync, "undefined", "Native async stepping needs explicit review")

// Capture only terminal retained data. No solver methods or getters are invoked
// by this projection, and no candidate geometry is reconstructed during routing.
function own(object: any, key: string): any {
  assert(object !== null && typeof object === "object", `Missing object for ${key}`)
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  assert(descriptor && "value" in descriptor, `Missing own data field ${key}`)
  return descriptor.value
}

function copyData(value: any, depth = 0): any {
  assert(depth < 40, "Capture data nesting exceeded 40")
  if (value === undefined) return { $undefined: true }
  if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) }
  assert(typeof value !== "function" && typeof value !== "symbol" && typeof value !== "bigint", "Unexpected executable or unsupported capture data")
  if (value === null || typeof value !== "object") return value
  if (value instanceof Map) return { $map: [...Map.prototype.entries.call(value)].map(([key, item]) => [copyData(key, depth + 1), copyData(item, depth + 1)]) }
  if (value instanceof Set) return { $set: [...Set.prototype.values.call(value)].map(item => copyData(item, depth + 1)) }
  if (ArrayBuffer.isView(value)) {
    assert(!(value instanceof DataView), "Unexpected DataView")
    return { $typedArray: Object.getPrototypeOf(value).constructor.name, values: Array.from(value as any, item => copyData(item, depth + 1)) }
  }
  if (Array.isArray(value)) return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor) return { $hole: true }
    assert("value" in descriptor, "Unexpected array accessor")
    return copyData(descriptor.value, depth + 1)
  })
  assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "Unexpected class in capture data")
  return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value)).filter(([, descriptor]) => descriptor.enumerable).map(([key, descriptor]) => {
    assert("value" in descriptor, `Unexpected accessor ${key}`)
    return [key, copyData(descriptor.value, depth + 1)]
  }))
}

function captureRejectedCandidates(regional: RuntimeObject): RuntimeObject {
  const params = own(regional, "params")
  const node = own(params, "nodeWithPortPoints")
  assert.equal(own(node, "capacityMeshNodeId"), "cmn_162")
  const boardObstacles = own(params, "boardObstacles")
  const obstacles = own(params, "obstacles")
  assert(Array.isArray(boardObstacles) && Array.isArray(obstacles))
  assert(obstacles.length >= boardObstacles.length)
  for (let index = 0; index < boardObstacles.length; index++) {
    assert.equal(obstacles[index], boardObstacles[index], `Shared board obstacle prefix differs at ${index}`)
  }
  const projectedParams: RuntimeObject = {}
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(params))) {
    if (!descriptor.enumerable) continue
    assert("value" in descriptor, `Unexpected parameter getter ${key}`)
    if (key === "obstacles") projectedParams[key] = { $arrayConcat: [{ $parameterRef: "boardObstacles" }, copyData(obstacles.slice(boardObstacles.length))] }
    else if (key === "connMap") projectedParams[key] = {
      $connectivityMap: true,
      netMap: copyData(own(descriptor.value, "netMap")),
      idToNetMap: copyData(own(descriptor.value, "idToNetMap")),
    }
    else projectedParams[key] = copyData(descriptor.value)
  }
  const candidates: RuntimeObject[] = []
  const highDensity = own(regional, "highDensitySolver")
  const growthSolvers = own(highDensity, "failedSolvers")
  assert(Array.isArray(growthSolvers))
  for (const [growthIndex, growth] of growthSolvers.entries()) {
    const originalNode = own(growth, "nodeWithPortPoints")
    const portfolios = own(growth, "failedSolvers")
    assert(Array.isArray(portfolios))
    for (const [portfolioIndex, portfolio] of portfolios.entries()) {
      const scaledNode = own(portfolio, "nodeWithPortPoints")
      const scale = own(scaledNode, "width") / own(originalNode, "width")
      assert([1, 2, 4, 8].some(value => Math.abs(value - scale) < 1e-9), "Unexpected retained portfolio scale")
      assert(Math.abs(own(scaledNode, "height") / own(originalNode, "height") - scale) < 1e-9)
      const wrappers = own(portfolio, "supervisedSolvers")
      assert(Array.isArray(wrappers) && wrappers.length <= 128)
      for (const [candidateIndex, wrapper] of wrappers.entries()) {
        const solver = own(wrapper, "solver")
        const error = own(solver, "error")
        if (error !== "Candidate solution rejected by validator") continue
        const hyperParameters = own(wrapper, "hyperParameters")
        const isA01 = Object.getOwnPropertyDescriptor(hyperParameters, "HIGH_DENSITY_A01")?.value === true
        const isA03 = Object.getOwnPropertyDescriptor(hyperParameters, "HIGH_DENSITY_A03")?.value === true
        assert(isA01 !== isA03, "Rejected candidate is not the expected A01/A03 family")
        const fields: RuntimeObject = {}
        for (const key of ["solvedRoutes", "connIdToName", "connIdToRootNet", "gridToBoundsTransform", "layerToZ", "traceThickness", "viaDiameter", "nodeWithPortPoints"]) fields[key] = copyData(own(solver, key))
        if (isA01) {
          assert(own(solver, "solvedRoutes") instanceof Map)
          fields.gridOrigin = copyData(own(solver, "gridOrigin"))
          fields.cellSizeMm = own(solver, "cellSizeMm")
        } else {
          const routes = own(solver, "solvedRoutes")
          const planeSize = own(solver, "planeSize")
          assert(Array.isArray(routes) && Number.isInteger(planeSize) && planeSize > 0)
          const cellIds = new Set<number>()
          for (const entry of routes) {
            if (entry === undefined) continue
            for (const route of Array.isArray(entry) ? entry : [entry]) {
              for (const state of own(route, "states")) cellIds.add(state % planeSize)
              for (const cellId of own(route, "viaCellIds")) cellIds.add(cellId)
            }
          }
          const x = own(solver, "cellCenterX"), y = own(solver, "cellCenterY")
          fields.planeSize = planeSize
          fields.referencedCellCenters = [...cellIds].sort((a, b) => a - b).map(cellId => {
            assert(Number.isInteger(cellId) && cellId >= 0 && cellId < planeSize)
            assert(Number.isFinite(x[cellId]) && Number.isFinite(y[cellId]))
            return [cellId, x[cellId], y[cellId]]
          })
          fields.cellCenterLengths = { x: x.length, y: y.length }
        }
        candidates.push({
          family: isA01 ? "A01" : "A03", scale, growthIndex, portfolioIndex, candidateIndex,
          hyperParameters: copyData(hyperParameters), originalNode: copyData(originalNode), scaledNode: copyData(scaledNode),
          state: Object.fromEntries(["solved", "failed", "error", "iterations", "MAX_ITERATIONS"].map(key => [key, copyData(own(solver, key))])),
          fields,
        })
        assert(candidates.length <= 4, "More than four rejected candidate records")
      }
    }
  }
  assert.equal(candidates.length, 4, "Expected all four retained rejected candidates")
  assert.deepEqual(candidates.map(candidate => `${candidate.family}:${candidate.scale}`).sort(), ["A01:1", "A03:2", "A03:4", "A03:8"])
  assert.equal(candidates.find(candidate => candidate.family === "A01")!.hyperParameters.SHUFFLE_SEED, 2)
  return {
    schemaVersion: 1, targetNode: "cmn_162", captureKind: "post-loop-own-data",
    regionalState: Object.fromEntries(["solved", "failed", "error", "iterations", "stats"].map(key => [key, copyData(own(regional, key))])),
    params: projectedParams, boardObstacleCount: boardObstacles.length,
    appendedObstacleCount: obstacles.length - boardObstacles.length, candidates,
    scope: "Raw retained published candidate states. No candidate getOutput, validator or geometry reconstruction was invoked. Repaired/unscaled/materialized output and exact conflict witnesses require offline source-equivalent reconstruction.",
  }
}

const write = (name: string, value: unknown): void => writeFileSync(resolve(outputDirectory, name), JSON.stringify(value, null, 2) + "\n")
const started = performance.now()
let lastFlush = started
let lastPhase: string | undefined
const phaseTransitions: RuntimeObject[] = []
let retainedRegional: RuntimeObject | null = null
let timedOut = false
let executionError: string | null = null
const state = (): RuntimeObject => ({
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
      const phase = pipeline.getCurrentPhase()
      if (phase !== lastPhase) {
        phaseTransitions.push({ phase, elapsedMs: performance.now() - started, iterations: pipeline.iterations })
        lastPhase = phase
      }
      if (performance.now() - started >= deadlineMs) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) {
      write("diagnostic-progress.json", state())
      lastFlush = performance.now()
    }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise<void>(done => setTimeout(done, 0))
  }
} catch (error) {
  executionError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error)
}
const terminalState = state()
const report: RuntimeObject = {
  schemaVersion: 1, ...terminalState, timedOut, executionError,
  inputSha256: sha(inputBytes), inputCompressedSha256: sha(compressedInput),
  initialInputCanonicalSha256, finalInputCanonicalSha256: sha(JSON.stringify(input)),
  inputFileUnchanged: sha(readFileSync(inputPath)) === sha(compressedInput),
  autorouterEntrySha256: sha(entryBytes), autorouterEntryUnchanged: sha(readFileSync(modulePath)) === sha(entryBytes),
  publishedCoreEntryUnchanged: sha(readFileSync(publishedCore.entry)) === publishedCore.entrySha256,
  planSha256: sha(planBytes), suppliedOptions: { cacheProvider: null },
  undefinedOptionKeys: ["capacityDepth", "targetMinCapacity", "effort"],
  effectiveOptions: pipeline.opts, effectiveEffort: pipeline.effort,
  captureDeadlineMs: deadlineMs, hardDeadlineSeconds: plan.hardDeadlineSeconds,
  phaseTransitions, wasmAttempts, coldImportWasmCalls,
  capture: { complete: false, status: "pending-post-loop-projection" },
  scope: "Published-only isolated phase diagnostic. No candidate patch, point movement, source override, accepted-output assessment or completion gain claim.",
}
// Preserve the native result before optional geometry serialization can fail.
write("report.json", report)
try {
  assert(retainedRegional, "No retained regional instance")
  assert(report.failed && !report.solved && !report.timedOut && !executionError, "Expected terminal native failure before capturing rejected candidates")
  const capture = captureRejectedCandidates(retainedRegional)
  const bytes = Buffer.from(JSON.stringify(capture))
  assert(bytes.length <= 6 * 1024 * 1024, "Rejected candidate capture exceeded 6 MiB")
  const compressed = gzipSync(bytes)
  writeFileSync(resolve(outputDirectory, "rejected-candidates.json.gz"), compressed)
  report.capture = { complete: true, status: "raw-four-candidate-state-retained", payloadSha256: sha(bytes), payloadBytes: bytes.length, compressedSha256: sha(compressed), compressedBytes: compressed.length, candidateCount: capture.candidates.length, boardObstacleCount: capture.boardObstacleCount, appendedObstacleCount: capture.appendedObstacleCount, maximumBytes: 6 * 1024 * 1024 }
} catch (error) {
  report.capture = { complete: false, status: "observation-failed", error: String(error).slice(0, 4000), nativeTerminalStatePreserved: true }
}
write("report.json", report)
console.log(JSON.stringify({ solved: report.solved, failed: report.failed, error: report.error, timedOut, executionError, elapsedMs: report.elapsedMs, capture: report.capture }))
if (executionError || wasmAttempts.length || !report.inputFileUnchanged || !report.autorouterEntryUnchanged || !report.publishedCoreEntryUnchanged || report.initialInputCanonicalSha256 !== report.finalInputCanonicalSha256 || !report.capture.complete) process.exitCode = 1
