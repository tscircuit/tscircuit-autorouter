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
const allowedFlags = ["--module", "--input", "--output", "--board", "--manifest", "--plan"]
assert.equal(process.argv.slice(2).length % 2, 0, "Expected flag/value pairs")
assert(Object.keys(flags).every((flag) => allowedFlags.includes(flag)), "Unknown diagnostic flag")
for (const flag of allowedFlags) {
  assert(flags[flag], `Missing ${flag}`)
}
const modulePath = resolve(flags["--module"]!)
const inputPath = resolve(flags["--input"]!)
const outputDirectory = resolve(flags["--output"]!)
const board = flags["--board"]!
const planBytes = readFileSync(resolve(flags["--plan"]!))
const plan = JSON.parse(planBytes.toString())
assert.equal(plan.qualificationReady, true, "Diagnostic controller remains held")
assert.equal(plan.captureDeadlineMs, 900000)
assert.equal(plan.hardDeadlineSeconds, 960)
const deadlineMs = plan.captureDeadlineMs
assert.equal(board, "imx6")
const nativeCase = plan.cases.imx6
assert(nativeCase && !nativeCase.targetRoot, "No target net or node is assumed")
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
assert.equal(sha(inputBytes), "010757e915e6ad2b138c2bc8dd37c43f09162490537d082957c7ae907d7a1cfd")
const input = JSON.parse(inputBytes.toString())
assert.equal(input.connections.length, 327)
assert.equal(input.connections.reduce((sum: number, connection: RuntimeObject) => sum + connection.pointsToConnect.length, 0), 862)
assert.equal(input.obstacles.length, 2922)
assert.equal(input.traces.length, 49)
const initialInputCanonicalSha256 = sha(JSON.stringify(input))
assert.equal(input.layerCount, 6)

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

type ActiveContext = { kind: string; solver: RuntimeObject; node: RuntimeObject | null }
const readOwn = (value: any, key: string): any => value && typeof value === "object" ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
const scalarKeys = ["solved", "failed", "iterations", "MAX_ITERATIONS", "scaleFactor", "MAX_RIPS", "ripCount", "totalRipEvents", "planeSize", "layers", "searchIterations", "baseSearchBudgetIters", "round", "routedCount", "conflictCount", "activeConnId", "activeConnectionIndex", "connectionName", "rootConnectionName", "error"]
const constructorKeys = ["highResolutionCellSize", "highResolutionCellThickness", "lowResolutionCellSize", "cellSizeMm", "viaDiameter", "maxCellCount", "stepMultiplier", "traceThickness", "traceWidth", "traceMargin", "obstacleClearanceMargin", "obstacleMargin", "viaMinDistFromBorder", "showPenaltyMap", "showUsedCellMap", "effort", "minClearance", "viaCopperClearance", "viaToPadClearance", "layerCount", "allowBlindAndBuriedVias", "captureSearchDebug", "hyperParameters"]
const write = (name: string, value: unknown): void => writeFileSync(resolve(outputDirectory, name), JSON.stringify(value, null, 2) + "\n")

function copyData(value: any, depth = 0): any {
  assert(depth < 40, "Capture data nesting exceeded 40")
  if (value === undefined) return { $undefined: true }
  if (typeof value === "function") return { $callbackOmitted: true }
  if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) }
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

function solverNode(solver: any): any {
  return readOwn(solver, "nodeWithPortPoints") ?? readOwn(readOwn(solver, "params"), "nodeWithPortPoints") ?? readOwn(readOwn(solver, "constructorParams"), "nodeWithPortPoints")
}

function scalarState(solver: any): RuntimeObject | null {
  if (!solver) return null
  const row: RuntimeObject = { className: Object.getPrototypeOf(solver)?.constructor?.name ?? null }
  for (const key of scalarKeys) {
    const value = readOwn(solver, key)
    if (typeof value === "string") row[key] = value.slice(0, 1024)
    else if (value === null || typeof value === "number" || typeof value === "boolean") row[key] = value
  }
  const stats = readOwn(solver, "stats")
  if (stats && typeof stats === "object") row.stats = Object.fromEntries(Object.keys(stats).flatMap(key => {
    const value = readOwn(stats, key)
    return value === null || ["number", "boolean", "string"].includes(typeof value) ? [[key, typeof value === "string" ? value.slice(0, 256) : value]] : []
  }))
  const node = solverNode(solver)
  if (node) row.node = { id: readOwn(node, "capacityMeshNodeId"), center: copyData(readOwn(node, "center")), width: readOwn(node, "width"), height: readOwn(node, "height"), portCount: readOwn(node, "portPoints")?.length }
  const names = readOwn(solver, "connIdToName")
  const segment = readOwn(solver, "activeConnSeg")
  const smallPoint = (point: any): any => point ? Object.fromEntries(["x", "y", "z", "connectionName", "rootConnectionName"].flatMap(key => {
    const value = readOwn(point, key)
    return typeof value === "number" || typeof value === "string" ? [[key, value]] : []
  })) : null
  if (segment) row.activeSegment = { connectionName: names?.[readOwn(segment, "connId")] ?? null, start: smallPoint(readOwn(segment, "startPoint")), end: smallPoint(readOwn(segment, "endPoint")) }
  for (const key of ["A", "B"]) if (readOwn(solver, key)) row[key] = smallPoint(readOwn(solver, key))
  const activeIndex = readOwn(solver, "activeConnectionIndex"), connections = readOwn(solver, "connections")
  if (Number.isInteger(activeIndex) && Array.isArray(connections) && connections[activeIndex]) row.activeConnection = { start: smallPoint(readOwn(connections[activeIndex], "start")), end: smallPoint(readOwn(connections[activeIndex], "end")) }
  const unsolved = readOwn(solver, "unsolvedSegs")
  if (Array.isArray(unsolved)) row.unsolvedSegmentCount = unsolved.length
  const routes = readOwn(solver, "solvedRoutes")
  if (routes instanceof Map) row.solvedConnectionCount = routes.size
  else if (Array.isArray(routes)) row.solvedConnectionCount = routes.filter(Boolean).length
  const hyperParameters = readOwn(solver, "hyperParameters")
  if (hyperParameters) row.hyperParameters = Object.fromEntries(Object.keys(hyperParameters).flatMap(key => {
    const value = readOwn(hyperParameters, key)
    return typeof value === "number" || typeof value === "boolean" ? [[key, value]] : []
  }))
  return row
}

function activeContext(): ActiveContext | null {
  const hd = pipeline.highDensityRouteSolver
  if (!hd) return null
  for (const [field, kind] of [["activeFallbackSolver", "regional"], ["activeRegularSolver", "regular"], ["activeB01Solver", "b01"]]) {
    const solver = readOwn(hd, field!)
    if (solver) return { kind: kind!, solver, node: readOwn(hd, "activeNode") ?? null }
  }
  return null
}

function retainedChain(root: any): { solvers: any[]; rows: RuntimeObject[]; truncated: boolean } {
  const solvers: any[] = [], rows: RuntimeObject[] = []
  const seen = new Set<any>()
  let solver = root, relation = "root"
  while (solver && !seen.has(solver) && solvers.length < 12) {
    seen.add(solver); solvers.push(solver)
    rows.push({ relation, ...scalarState(solver) })
    let next = readOwn(solver, "activeSubSolver")
    relation = "activeSubSolver"
    if (!next) { next = readOwn(solver, "highDensitySolver"); relation = "highDensitySolver" }
    if (!next && readOwn(solver, "failed")) {
      const failed = readOwn(solver, "failedSolvers") ?? readOwn(solver, "failedSubSolvers")
      if (Array.isArray(failed) && failed.length) { next = failed[failed.length - 1]; relation = "lastRetainedFailedChild" }
    }
    solver = next
  }
  return { solvers, rows, truncated: Boolean(solver && !seen.has(solver)) }
}

function captureNode(context: ActiveContext): RuntimeObject {
  const chain = retainedChain(context.solver)
  const nodes = [context.node, ...chain.solvers.map(solverNode)].filter(Boolean)
  const uniqueNodes = [...new Map(nodes.map(node => [sha(JSON.stringify(node)), node])).values()]
  const rootParams = readOwn(context.solver, "params") ?? readOwn(context.solver, "constructorParams") ?? context.solver
  const obstacleSource = readOwn(rootParams, "obstacles") ?? readOwn(context.solver, "obstacles")
  const obstacles = Array.isArray(obstacleSource) ? obstacleSource : []
  const padding = 1
  const selectedObstacles = context.kind === "b01" ? obstacles : obstacles.filter(obstacle => {
    const center = readOwn(obstacle, "center"), width = readOwn(obstacle, "width"), height = readOwn(obstacle, "height")
    if (!center || !Number.isFinite(width) || !Number.isFinite(height) || !uniqueNodes.length) return true
    const radius = Math.hypot(width, height) / 2 + padding
    return uniqueNodes.some(node => Math.abs(center.x - node.center.x) <= node.width / 2 + radius && Math.abs(center.y - node.center.y) <= node.height / 2 + radius)
  })
  const constructor = Object.fromEntries(constructorKeys.flatMap(key => {
    const value = readOwn(rootParams, key) ?? readOwn(context.solver, key)
    return value === undefined ? [] : [[key, copyData(value)]]
  }))
  const leaf = chain.solvers[chain.solvers.length - 1]
  const leafFields: RuntimeObject = {}
  for (const key of ["routes", "solvedRoutes", "validatedRoutes", "nodeWithPortPoints", "connIdToName", "connIdToRootNet", "gridOrigin", "cellSizeMm", "gridToBoundsTransform", "layerToZ", "planeSize", "traceThickness", "viaDiameter"]) {
    const value = readOwn(leaf, key)
    if (value !== undefined) leafFields[key] = copyData(value)
  }
  const rawRoutes = readOwn(leaf, "solvedRoutes"), planeSize = readOwn(leaf, "planeSize")
  const x = readOwn(leaf, "cellCenterX"), y = readOwn(leaf, "cellCenterY")
  if (Array.isArray(rawRoutes) && Number.isInteger(planeSize) && x && y) {
    const cells = new Set<number>()
    for (const entry of rawRoutes) for (const route of entry === undefined ? [] : Array.isArray(entry) ? entry : [entry]) {
      for (const state of readOwn(route, "states") ?? []) cells.add(state % planeSize)
      for (const cell of readOwn(route, "viaCellIds") ?? []) cells.add(cell)
    }
    leafFields.referencedCellCenters = [...cells].sort((a, b) => a - b).map(cell => [cell, x[cell], y[cell]])
  }
  const validatedRoutes = readOwn(context.solver, "validatedRoutes")
  const rootRoutes = validatedRoutes ?? readOwn(context.solver, "routes") ?? readOwn(readOwn(context.solver, "highDensitySolver"), "routes")
  return {
    schemaVersion: 1, kind: context.kind, state: scalarState(context.solver), chain: chain.rows,
    nodes: copyData(uniqueNodes), constructorScalars: constructor,
    obstacles: copyData(selectedObstacles), obstaclesScope: context.kind === "b01" ? "complete-own-B01-constructor-obstacles" : "selected-native-obstacles-near-retained-node-bounds",
    originalObstacleCount: obstacles.length, selectedObstacleCount: selectedObstacles.length,
    originalObstaclesSha256: sha(JSON.stringify(obstacles)), selectionPaddingMm: padding,
    rootRoutes: copyData(rootRoutes), rootRoutesValidatedByRegional: validatedRoutes !== undefined,
    leafFields, fullConstructorCaptured: false,
    scope: "Selected terminal node data only. No solver getters/methods called. Scalar constructor projection omits global maps, callbacks and unrelated board context; the complete original SRJ is separately authenticated. Unvalidated route state is diagnostic, never accepted copper.",
  }
}

const started = performance.now()
let lastFlush = started, lastPhase: string | undefined
let timedOut = false, executionError: string | null = null
let lastContext: ActiveContext | null = null, outputSha256: string | null = null
const checkpoints: RuntimeObject[] = [], phaseTransitions: RuntimeObject[] = [], observationErrors: string[] = []
const state = (): RuntimeObject => ({ solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error, iterations: pipeline.iterations, MAX_ITERATIONS: pipeline.MAX_ITERATIONS, activePhase: pipeline.getCurrentPhase(), elapsedMs: performance.now() - started, highDensity: scalarState(pipeline.highDensityRouteSolver) })
function saveCheckpoint(): void {
  try {
    const current = activeContext()
    const hd = pipeline.highDensityRouteSolver
    const sample = { ...state(), activeKind: current?.kind ?? null, activeNodeId: current?.node?.capacityMeshNodeId ?? null, remainingNodes: readOwn(hd, "unsolvedNodePortPoints")?.length ?? null, activeB01: scalarState(readOwn(hd, "activeB01Solver")), activeRegular: scalarState(readOwn(hd, "activeRegularSolver")), activeRegional: scalarState(readOwn(hd, "activeFallbackSolver")), activeChain: retainedChain(current?.solver ?? pipeline.activeSubSolver).rows }
    assert(Buffer.byteLength(JSON.stringify(sample)) <= 32768, "Scalar checkpoint exceeded 32 KiB")
    assert(checkpoints.length < 100, "Scalar checkpoint count exceeded 100")
    checkpoints.push(sample)
    write("diagnostic-progress.json", { sampleIntervalMs: 10000, checkpoints, observationErrors })
  } catch (error) { if (observationErrors.length < 8) observationErrors.push(String(error).slice(0, 1024)) }
}
saveCheckpoint()
try {
  while (!pipeline.solved && !pipeline.failed) {
    const batchStarted = performance.now()
    do {
      const current = activeContext()
      if (current) lastContext = current
      pipeline.step()
      const phase = pipeline.getCurrentPhase()
      if (phase !== lastPhase) { phaseTransitions.push({ phase, elapsedMs: performance.now() - started, iterations: pipeline.iterations }); lastPhase = phase }
      if (performance.now() - started >= deadlineMs) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) { saveCheckpoint(); lastFlush = performance.now() }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise<void>(done => setTimeout(done, 0))
  }
  if (pipeline.solved && !pipeline.failed && !timedOut) {
    const output = JSON.stringify(pipeline.getOutputSimpleRouteJson())
    outputSha256 = sha(output)
    writeFileSync(resolve(outputDirectory, "phase-output.srj.json.gz"), gzipSync(output))
  }
} catch (error) { executionError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error) }
const terminalState = state()
const currentAtStop = activeContext()
if (currentAtStop) lastContext = currentAtStop
saveCheckpoint()
const report: RuntimeObject = {
  schemaVersion: 1, board, ...terminalState, timedOut, executionError, outputSha256,
  inputSha256: sha(inputBytes), inputCompressedSha256: sha(compressedInput), initialInputCanonicalSha256, finalInputCanonicalSha256: sha(JSON.stringify(input)),
  inputFileUnchanged: sha(readFileSync(inputPath)) === sha(compressedInput), autorouterEntrySha256: sha(entryBytes), autorouterEntryUnchanged: sha(readFileSync(modulePath)) === sha(entryBytes), publishedCoreEntryUnchanged: sha(readFileSync(publishedCore.entry)) === publishedCore.entrySha256,
  planSha256: sha(planBytes), suppliedOptions: { cacheProvider: null }, undefinedOptionKeys: ["capacityDepth", "targetMinCapacity", "effort"], effectiveOptions: pipeline.opts, effectiveEffort: pipeline.effort, captureDeadlineMs: deadlineMs, hardDeadlineSeconds: plan.hardDeadlineSeconds,
  phaseTransitions, wasmAttempts, coldImportWasmCalls, observationErrors, checkpointCount: checkpoints.length,
  finalCapture: { status: "pending-post-loop-projection" },
  scope: "Published-only fresh iMX6 phase4 diagnostic; original whole-board run had about314.6s remaining. No source/candidate intervention or whole-board timing/completion claim. Accepted phase output is retained without a physical qualification claim.",
}
write("report.json", report)
try {
  if (!(report.failed || timedOut || executionError)) report.finalCapture = { status: "not-needed-phase-solved" }
  else if (!lastContext) report.finalCapture = { status: "no-HD-context-reached", complete: false }
  else {
    const capture = captureNode(lastContext)
    const bytes = Buffer.from(JSON.stringify(capture))
    assert(bytes.length <= 6 * 1024 * 1024, "Final selected-node capture exceeded 6 MiB")
    const compressed = gzipSync(bytes)
    writeFileSync(resolve(outputDirectory, "final-node.json.gz"), compressed)
    report.finalCapture = { status: "selected-node-retained", complete: true, activeAtStop: activeContext()?.solver === lastContext.solver, kind: lastContext.kind, nodeId: lastContext.node?.capacityMeshNodeId ?? null, payloadSha256: sha(bytes), payloadBytes: bytes.length, compressedSha256: sha(compressed), compressedBytes: compressed.length, maximumBytes: 6291456, selectedObstacleCount: capture.selectedObstacleCount, originalObstacleCount: capture.originalObstacleCount, scope: capture.obstaclesScope }
  }
} catch (error) { report.finalCapture = { status: "observation-failed", complete: false, error: String(error).slice(0, 4000), nativeTerminalStatePreserved: true } }
write("report.json", report)
console.log(JSON.stringify({ board, solved: report.solved, failed: report.failed, timedOut, error: report.error, executionError, outputSha256, elapsedMs: report.elapsedMs, finalCapture: report.finalCapture }))
if (executionError || wasmAttempts.length || !report.inputFileUnchanged || !report.autorouterEntryUnchanged || !report.publishedCoreEntryUnchanged || report.initialInputCanonicalSha256 !== report.finalInputCanonicalSha256) process.exitCode = 1
