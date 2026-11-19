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
assert.equal(sha(inputBytes), plan.inputSha256)
assert.equal(plan.expectedOutputSha256, "32ced6782aaa48679f9412c65c6069d1e6130d419c48bb364fbe32d149ceadda")
assert.deepEqual(plan.targetConnectionNames, ["source_net_18", "source_net_53", "source_net_63"])
assert.equal(plan.maximumCaptureBytes, 8388608)
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
// Read own data only. In particular, simplifiedHdRoutes is a prototype getter.
const own = (object: any, key: string): any => object == null ? undefined : Object.getOwnPropertyDescriptor(object, key)?.value
const targets = new Set<string>(plan.targetConnectionNames)
const aliases = new Set<string>(targets)
const targetTraceIndexes = new Set<number>()
const targetTraceIds = new Set<string>()
for (const [index, trace] of (input.traces ?? []).entries()) {
  if (!targets.has(trace.connection_name)) continue
  targetTraceIndexes.add(index)
  targetTraceIds.add(trace.pcb_trace_id)
}
assert([...targetTraceIndexes].some(index => input.traces[index].connection_name === "source_net_63"))
const named = (value: unknown): boolean => typeof value === "string" && (aliases.has(value) || [...targets].some(target => value.startsWith(`${target}_`)) || targetTraceIds.has(value))
const matches = (route: any): boolean => route != null && (
  ["connectionName", "rootConnectionName", "connection_name", "pcb_trace_id", "traceId", "syntheticConnectionName"].some(key => named(own(route, key))) ||
  targetTraceIndexes.has(own(route, "preloadedTraceIndex")) ||
  (own(route, "originalTrace") != null && matches(own(route, "originalTrace")))
)
const selected = (routes: any): any[] => Array.isArray(routes) ? routes.filter(matches) : []
const observationErrors: Data[] = []
const recordObservationError = (where: string, error: unknown): void => {
  if (observationErrors.length < 32) observationErrors.push({ where, error: String(error).slice(0, 2000) })
}
const observe = (where: string, callback: () => void): void => { try { callback() } catch (error) { recordObservationError(where, error) } }
const blobs: Data = {}
let retainedBytes = 0
function copyData(value: any, depth = 0): any {
  assert(depth < 48, "Capture data nesting exceeded bound")
  if (value === undefined) return { $undefined: true }
  if (value === null || ["string", "boolean"].includes(typeof value)) return value
  if (typeof value === "number") return Number.isFinite(value) ? value : { $number: String(value) }
  assert(typeof value === "object", "Unexpected executable capture value")
  if (Array.isArray(value)) return value.map(item => copyData(item, depth + 1))
  if (value instanceof Map) return { $map: [...value].map(([key, entry]) => [copyData(key, depth + 1), copyData(entry, depth + 1)]) }
  if (value instanceof Set) return { $set: [...value].map(entry => copyData(entry, depth + 1)) }
  assert(!ArrayBuffer.isView(value), "Whole grid/typed-array buffers are excluded")
  assert([Object.prototype, null].includes(Object.getPrototypeOf(value)), "Unexpected class in selected capture")
  return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value)).filter(([, descriptor]) => descriptor.enumerable).map(([key, descriptor]) => {
    assert("value" in descriptor, `Unexpected getter ${key}`)
    return [key, copyData(descriptor.value, depth + 1)]
  }))
}
function blob(value: any): Data {
  const data = copyData(value)
  const text = JSON.stringify(data)
  const digest = sha(text), bytes = Buffer.byteLength(text)
  const retained = Boolean(blobs[digest]) || retainedBytes + bytes <= plan.maximumCaptureBytes
  if (retained && !blobs[digest]) { blobs[digest] = data; retainedBytes += bytes }
  if (!retained) recordObservationError("capture-size", `Selected blob ${digest} exceeds ${plan.maximumCaptureBytes} bytes`)
  return { sha256: digest, bytes, retained }
}
const pick = (object: any, keys: string[]): Data => Object.fromEntries(keys.flatMap(key => {
  const descriptor = object == null ? undefined : Object.getOwnPropertyDescriptor(object, key)
  return descriptor && "value" in descriptor && typeof descriptor.value !== "function" ? [[key, descriptor.value]] : []
}))
const settingsKeys = ["viaDiameter", "viaHoleDiameter", "traceWidth", "traceThickness", "traceMargin", "obstacleMargin", "obstacleClearanceMargin", "minClearance", "viaCopperClearance", "viaToPadClearance", "layerCount", "allowBlindAndBuriedVias", "viaMinDistFromBorder", "cellSizeMm", "effort", "scaleFactor"]
const stateKeys = ["solved", "failed", "error", "iterations", "MAX_ITERATIONS", "stats"]
function refreshAliases(): void {
  const ids = own(own(pipeline, "connMap"), "idToNetMap")
  if (ids) for (const [id, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(ids))) {
    if (named(id) && "value" in descriptor && typeof descriptor.value === "string") aliases.add(descriptor.value)
  }
  const joint = own(pipeline, "pipeline9JointDrcRepairSolver")
  for (const section of own(joint, "movablePreloadedSections") ?? []) {
    if (matches(own(section, "originalTrace"))) aliases.add(own(section, "syntheticConnectionName"))
  }
}
function fixedState(hd: any): Data {
  const original = selected(own(hd, "fixedHdRoutes"))
  const replacements = own(hd, "fixedRouteReplacements")
  const names = new Set(original.map(route => own(route, "connectionName")))
  const replacementEntries = replacements instanceof Map ? [...replacements].filter(([name, route]) => names.has(name) || named(name) || matches(route)) : []
  for (const [name] of replacementEntries) names.add(name)
  const masks = own(hd, "preloadedTraceMutationMasks")
  const removed = own(hd, "removedFixedRouteConnectionNames")
  return {
    original: blob(original), replacements: blob(replacementEntries),
    removed: blob(removed instanceof Set ? [...removed].filter(name => names.has(name) || named(name)) : []),
    mutationMasks: blob(masks instanceof Map ? [...masks].filter(([name]) => names.has(name) || named(name)) : []),
  }
}
function mappedRoutes(solver: any, key: string): any[] {
  const original = own(solver, "originalHdRoutes")
  const replacements = own(solver, key)
  return Array.isArray(original) ? original.map((route, index) => replacements instanceof Map ? replacements.get(index) ?? route : route) : []
}
function selectedSamples(solver: any): any[] {
  const original = own(solver, "originalHdRoutes")
  return (own(solver, "sampleEntries") ?? []).filter((entry: any) => (own(entry, "routeIndexes") ?? []).some((index: number) => matches(original?.[index])))
}
function forceOrRepair(solver: any, mapKey: string): Data | null {
  if (!solver) return null
  return {
    state: blob(pick(solver, stateKeys)), input: blob(selected(own(solver, "originalHdRoutes"))),
    output: blob(selected(mappedRoutes(solver, mapKey))), samples: blob(selectedSamples(solver)),
  }
}
function nodeMatches(node: any): boolean {
  return selected(own(node, "portPoints")).length > 0 || (own(node, "portPointsInPairs") ?? []).some((pair: any) => Array.isArray(pair) && pair.some(matches))
}
function sectionMatches(section: any): boolean {
  return matches(section) || selected(own(section, "sourceRoutes")).length > 0 || matches(own(section, "route")) || matches(own(section, "originalRoute"))
}
const producerHistory: Data[] = []
const stageHistory: Data[] = []
const retainedGrowthByHd = new WeakMap<object, any>()
const selectedRegionalStarts = new WeakMap<object, Data>()
const seenRegionalStarts = new WeakSet<object>()
let initialFixedState: Data | null = null
const hooked = new WeakSet<object>()
const originalHookDescriptors: Array<{ object: any, descriptor?: PropertyDescriptor }> = []
let uniformBoundary: Data | null = null
function inspectUniformBoundary(): void {
  const uniform = own(pipeline, "uniformPortDistributionSolver")
  if (uniformBoundary || !own(uniform, "solved")) return
  assert.equal(own(pipeline, "activeSubSolver"), null)
  assert.equal(pipeline.getCurrentPhase(), "highDensityRouteSolver")
  assert.equal(own(pipeline, "highDensityRouteSolver"), undefined)
  const nodes = own(uniform, "redistributedNodes")
  uniformBoundary = { nodesSha256: sha(JSON.stringify(nodes)), nodeCount: nodes.length, pointInterventionApplied: false }
}
// This wrapper preserves the original receiver, all arguments, return value,
// and thrown exceptions. Observation errors never prevent the original call.
function wrapFinish(original: Function, before: (receiver: any, args: any[]) => any, after: (receiver: any, args: any[], token: any) => void, onError: (error: unknown) => void): Function {
  return function (this: any, ...args: any[]): any {
    let token: any
    try { token = before(this, args) } catch (error) { onError(error) }
    const result = Reflect.apply(original, this, args)
    try { after(this, args, token) } catch (error) { onError(error) }
    return result
  }
}
function producerSnapshot(hd: any, rawRoutes: any): Data | null {
  refreshAliases()
  const node = own(hd, "activeNode")
  const sections = own(hd, "activeFallbackFixedRouteSections")
  const targetSections = sections instanceof Map ? [...sections].filter(([name, section]) => named(name) || sectionMatches(section)) : []
  const relevant = nodeMatches(node) || selected(rawRoutes).length > 0 || targetSections.length > 0
  if (!relevant) return null
  assert(producerHistory.length < 256, "Selected producer history exceeded bound")
  const b01 = own(hd, "activeB01Solver"), regular = own(hd, "activeRegularSolver"), regional = own(hd, "activeFallbackSolver")
  const innerHd = regular ?? own(regional, "highDensitySolver")
  const growth = innerHd ? retainedGrowthByHd.get(innerHd) : undefined
  const portfolio = own(growth, "winningSolver")
  const winner = own(portfolio, "winningSolver")
  const wrappers = own(portfolio, "supervisedSolvers")
  const winnerWrapper = Array.isArray(wrappers) ? wrappers.find(entry => own(entry, "solver") === winner) : undefined
  const params = own(regional, "params")
  const metadata = own(innerHd, "nodeSolveMetadataById")
  const record: Data = {
    nodeId: own(node, "capacityMeshNodeId"), parentIterations: own(hd, "iterations"),
    family: b01 ? "B01" : regional ? "regional" : "regular",
    originalNode: blob(node), inputToFinish: blob(selected(rawRoutes)), fixedAtFinish: fixedState(hd),
    beforeRegionalSplice: regional ? selectedRegionalStarts.get(regional) ?? null : null,
    parentSettings: blob(pick(hd, settingsKeys)), fixedSections: blob(targetSections),
    regionalNode: params ? blob(own(params, "nodeWithPortPoints")) : null,
    constructorSettings: blob(pick(b01 ?? params ?? innerHd, settingsKeys)),
    constructorObstacles: blob(own(b01 ?? params ?? innerHd, "obstacles") ?? []),
    producerMetadata: blob(metadata instanceof Map ? [...metadata.values()] : []),
    growth: growth ? blob({ ...pick(growth, [...stateKeys, "scaleFactor", "growthAttempts"]), nodeWithPortPoints: own(growth, "nodeWithPortPoints"), settings: pick(own(growth, "constructorParams"), settingsKeys), selectedRoutes: selected(own(growth, "solvedRoutes")) }) : null,
    winningPortfolio: portfolio ? blob({ ...pick(portfolio, stateKeys), nodeWithPortPoints: own(portfolio, "nodeWithPortPoints"), settings: pick(own(portfolio, "constructorParams"), settingsKeys), selectedRoutes: selected(own(portfolio, "solvedRoutes")), hyperParameters: own(winnerWrapper, "hyperParameters"), winnerSettings: pick(winner, settingsKeys), winnerNode: own(winner, "nodeWithPortPoints"), winnerObstacles: own(winner, "obstacles") ?? own(own(winner, "constructorParams"), "obstacles") }) : null,
    regionalRawRoutes: regional ? blob(selected(own(own(regional, "highDensitySolver"), "routes"))) : null,
    regionalValidatedRoutes: regional ? blob(selected(own(regional, "validatedRoutes"))) : null,
    regionalForce: forceOrRepair(own(regional, "forceImproveSolver"), "improvedRoutesByIndex"),
    regionalRepair: forceOrRepair(own(regional, "repairSolver"), "repairedRoutesByIndex"),
  }
  producerHistory.push(record)
  return record
}
function observeHdBeforeStep(): void {
  const hd = own(pipeline, "highDensityRouteSolver")
  if (!hd) return
  if (!hooked.has(hd)) {
    refreshAliases()
    initialFixedState = fixedState(hd)
    let prototype = Object.getPrototypeOf(hd), method: PropertyDescriptor | undefined
    while (prototype && !method) { method = Object.getOwnPropertyDescriptor(prototype, "finishActiveNode"); prototype = Object.getPrototypeOf(prototype) }
    assert(method && "value" in method && typeof method.value === "function", "Expected existing finishActiveNode method")
    originalHookDescriptors.push({ object: hd, descriptor: Object.getOwnPropertyDescriptor(hd, "finishActiveNode") })
    Object.defineProperty(hd, "finishActiveNode", { configurable: true, writable: true, value: wrapFinish(method.value,
      (receiver, args) => ({ count: own(receiver, "routes").length, record: producerSnapshot(receiver, args[0]) }),
      (receiver, _args, token) => {
        if (!token?.record) return
        token.record.appendedRoutes = blob(selected(own(receiver, "routes").slice(token.count)))
        token.record.fixedAfterFinish = fixedState(receiver)
      }, error => recordObservationError("finishActiveNode", error)) })
    hooked.add(hd)
  }
  const regional = own(hd, "activeFallbackSolver")
  if (regional && !seenRegionalStarts.has(regional)) {
    seenRegionalStarts.add(regional)
    refreshAliases()
    const sections = own(hd, "activeFallbackFixedRouteSections")
    const targetSections = sections instanceof Map ? [...sections].filter(([name, section]) => named(name) || sectionMatches(section)) : []
    if (nodeMatches(own(hd, "activeNode")) || nodeMatches(own(own(regional, "params"), "nodeWithPortPoints")) || targetSections.length) {
      selectedRegionalStarts.set(regional, {
        fixedState: fixedState(hd), fixedSections: blob(targetSections),
        regionalNode: blob(own(own(regional, "params"), "nodeWithPortPoints")),
      })
    }
  }
  // HighDensity clears its active child before Pipeline9 finishes the node.
  // Keep that one reference; its winning chain remains data after completion.
  for (const inner of [own(hd, "activeRegularSolver"), own(own(hd, "activeFallbackSolver"), "highDensitySolver")]) {
    const growth = own(inner, "activeSubSolver")
    if (inner && growth) retainedGrowthByHd.set(inner, growth)
  }
}
function stageSnapshot(stage: string): void {
  refreshAliases()
  const solver = own(pipeline, stage)
  if (!solver) return
  const fields: Data = {}
  const routes = (key: string, value: any): void => { if (Array.isArray(value)) fields[key] = blob(selected(value)) }
  for (const key of ["routes", "originalHdRoutes", "inputHdRoutes", "guardedInputHdRoutes", "outputHdRoutes", "mergedHdRoutes", "hdRoutes", "hdRoutesWithWidths", "inputNewHdRoutes", "combinedOutput", "bestRoutes"]) routes(key, own(solver, key))
  if (stage === "highDensityRouteSolver") fields.fixedState = fixedState(solver)
  if (stage === "highDensityForceImproveSolver") fields.accepted = forceOrRepair(solver, "improvedRoutesByIndex")
  if (stage === "highDensityRepairSolver") fields.accepted = forceOrRepair(solver, "repairedRoutesByIndex")
  const config = own(solver, "simplificationConfig")
  routes("simplificationInput", own(config, "hdRoutes"))
  routes("simplificationOtherRoutes", own(config, "otherHdRoutes"))
  routes("materializedPreloadedTraces", own(own(solver, "srj"), "traces"))
  routes("inputUpdatedPreloadedTraces", own(solver, "inputUpdatedPreloadedTraces"))
  const sections = own(solver, "movablePreloadedSections")
  if (Array.isArray(sections)) fields.movablePreloadedSections = blob(sections.filter(section => matches(own(section, "originalTrace"))))
  const cleanupConfig = own(own(solver, "params"), "config")
  routes("cleanupInput", own(cleanupConfig, "hdRoutes"))
  routes("cleanupOtherRoutes", own(cleanupConfig, "otherHdRoutes"))
  // Subsequent optional stages retain their own input/output; no getOutput call.
  routes("postprocessingInput", own(own(solver, "inputProblem"), "hdRoutes"))
  routes("postprocessingFallback", own(own(solver, "fallbackOutput"), "hdRoutes"))
  if (Object.keys(fields).length) stageHistory.push({ stage, state: blob(pick(solver, stateKeys)), fields })
}
const started = performance.now()
let lastFlush = started
let lastPhase: string | undefined
const phaseTransitions: Data[] = []
let timedOut = false
let thrownError: string | null = null
let outputSha256: string | null = null
let nativeOutput: any = null
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
      observe("before-step", observeHdBeforeStep)
      pipeline.step()
      observe("uniform-boundary", inspectUniformBoundary)
      const phase = pipeline.getCurrentPhase()
      if (phase !== lastPhase) {
        if (lastPhase) observe(`stage:${lastPhase}`, () => stageSnapshot(lastPhase!))
        phaseTransitions.push({ phase, elapsedMs: performance.now() - started, iterations: pipeline.iterations })
        lastPhase = phase
      }
      if (performance.now() - started >= plan.captureDeadlineMs) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) { write("progress.json", state()); lastFlush = performance.now() }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise<void>(done => setTimeout(done, 0))
  }
  if (pipeline.solved && !pipeline.failed && !timedOut) {
    assert(uniformBoundary, "Full phase solved without the original Uniform boundary")
    nativeOutput = pipeline.getOutputSimpleRouteJson()
    const output = JSON.stringify(nativeOutput)
    outputSha256 = sha(output)
    writeFileSync(resolve(outputDirectory, "phase-output.srj.json.gz"), gzipSync(output))
  }
} catch (error) {
  thrownError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error)
} finally {
  for (const { object, descriptor } of originalHookDescriptors) {
    if (descriptor) Object.defineProperty(object, "finishActiveNode", descriptor)
    else delete object.finishActiveNode
  }
}
const terminalState = state()
const report: Data = {
  schemaVersion: 1, variant, ...terminalState, timedOut, thrownError, outputSha256,
  expectedOutputSha256: plan.expectedOutputSha256, expectedOutputMatched: outputSha256 === plan.expectedOutputSha256,
  inputSha256: sha(inputBytes), inputCompressedSha256: sha(inputCompressed),
  initialInputCanonicalSha256: sha(inputCanonical), finalInputCanonicalSha256: sha(JSON.stringify(input)),
  inputFileUnchanged: sha(readFileSync(inputPath)) === sha(inputCompressed),
  autorouterEntrySha256: sha(moduleBytes), autorouterEntryUnchanged: sha(readFileSync(modulePath)) === sha(moduleBytes),
  publishedAutorouterEntryUnchanged: sha(readFileSync(autorouter.entry)) === mapping.originalAutorouterSha256,
  planSha256: sha(planBytes), mappingSha256: sha(mapBytes), sourceCandidate: mapping.source,
  suppliedOptions: { cacheProvider: null }, undefinedOptionKeys: ["capacityDepth", "targetMinCapacity", "effort"],
  effectiveOptions: pipeline.opts, effectiveEffort: pipeline.effort,
  captureDeadlineMs: plan.captureDeadlineMs, hardDeadlineSeconds: plan.hardDeadlineSeconds,
  uniformBoundary, phaseTransitions, wasmAttempts, coldImportWasmCalls,
  historySha256: null, observationErrors,
  scope: "Selected H616 cramped-guard phase4 route and preload histories. No search/scheduling changes, extra solver/geometry calls, or physical assessment. Diagnostic authority requires exact equality with the previously authenticated raw phase output.",
}
// Preserve native terminal state and raw output before final optional projection.
write("report.json", report)
observe("final-history", () => {
  refreshAliases()
  const history = {
    schemaVersion: 1, inputSha256: sha(inputBytes), outputSha256,
    targetConnectionNames: [...targets], aliases: [...aliases].sort(),
    targetPreloadedTraceIndexes: [...targetTraceIndexes], targetPreloadedTraceIds: [...targetTraceIds],
    initialTraces: blob(selected(input.traces)), finalTraces: blob(selected(nativeOutput?.traces)),
    initialFixedState, producerHistory, stageHistory, blobs, retainedBytes, maximumBlobBytes: plan.maximumCaptureBytes,
    lifetimeNotes: ["finishActiveNode input and producer own fields captured before parent clears them; appended routes captured immediately afterward.", "Regional cleanup only retains the accepted candidate; rejected cleanup locals are not available.", "Selected route snapshots are immutable, hash-deduplicated data; no full-stage route arrays or grid buffers are retained.", "Source63 synthetic sections are linked through originalTrace and preloadedTraceIndex, not a name substring alone."],
  }
  const bytes = Buffer.from(JSON.stringify(history) + "\n")
  assert(bytes.length <= plan.maximumCaptureBytes + 1048576, "History envelope exceeded bound")
  const compressed = gzipSync(bytes)
  writeFileSync(resolve(outputDirectory, "via-history.json.gz"), compressed)
  report.historySha256 = sha(bytes)
  report.historyCompressedSha256 = sha(compressed)
  report.historyBytes = bytes.length
  report.producerCount = producerHistory.length
  report.stageCount = stageHistory.length
})
write("report.json", report)
console.log(JSON.stringify({ variant, solved: report.solved, failed: report.failed, error: report.error, timedOut, thrownError, outputSha256, expectedOutputMatched: report.expectedOutputMatched, elapsedMs: report.elapsedMs, observationErrors }))
if (thrownError || wasmAttempts.length || !report.inputFileUnchanged || !report.autorouterEntryUnchanged || !report.publishedAutorouterEntryUnchanged || report.initialInputCanonicalSha256 !== report.finalInputCanonicalSha256 || !report.expectedOutputMatched || observationErrors.length || !report.historySha256) process.exitCode = 1
