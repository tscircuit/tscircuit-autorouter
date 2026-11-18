import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

type Data = Record<string, any>
const [moduleArgument, outputArgument, manifestArgument] = process.argv.slice(2)
assert(moduleArgument && outputArgument && manifestArgument)
const modulePath = resolve(moduleArgument), output = resolve(outputArgument)
mkdirSync(output, { recursive: true })
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex")
const manifest = JSON.parse(readFileSync(manifestArgument, "utf8"))
const core = manifest.packages.find((entry: Data) => entry.name === "@tscircuit/core")
assert.equal(manifest.mainVersion, "0.0.3234")
assert.equal(core.version, "0.0.2414")
assert.equal(core.entrySha256, "9dbc237005e3a517d804d7661abd1a2d4519b7b678abac237d636ad8d84d26d6")
assert.equal(hash(readFileSync(core.entry)), core.entrySha256)
assert.equal(manifest.routingSourceOverride.sourceCandidateCommit, "a928e5c2c0d7a13b4038430fb4fa3b9008b8bdb6")
assert.equal(manifest.routingSourceOverride.autorouterSourceOverride, false)
assert.equal(Bun.version, "1.4.3")
assert.equal(process.arch, "arm64")
const inputBytes = gunzipSync(readFileSync(resolve(output, "phase-2-input.srj.json.gz")))
assert.equal(hash(inputBytes), "cc7843ecfae413f5afc1eefc88fa5dcd92e152aba3bb97fa266bd6ef1cafb272")
const input = JSON.parse(inputBytes.toString())
const canonicalRawInputBeforeSha256 = hash(JSON.stringify(input))
const events: Data[] = [], pipelines: Data[] = [], instances: Data[] = []
const eventCounts: Record<string, number> = {}, aggregates: Record<string, Data> = {}
const generatedCalls: Data[] = [], observerErrors: string[] = [], stack: number[] = []
const domains: Record<string, Data> = {}, subpasses: Data[] = []
const ids = new WeakMap<object, number>()
let droppedExamples = 0, startedAt = performance.now(), lastFlush = -Infinity
let lastEvent: Data | null = null, executionError: string | null = null
let checkpointCount = 0
const nativeNames = input.connections.map((connection: Data) => connection.name)
const point = (value: Data): Data => ({ x: value.x, y: value.y, layer: value.layer, pointId: value.pointId ?? null, pcb_port_id: value.pcb_port_id ?? null })
function compactInput(value: Data): Data {
  return { sha256: hash(JSON.stringify(value)), obstacles: value.obstacles.length, traces: value.traces?.length ?? 0,
    connections: value.connections.map((c: Data) => ({ name: c.name, terminals: c.pointsToConnect.map(point) })) }
}
function compact(value: any, depth = 0): any {
  if (ArrayBuffer.isView(value)) return { omittedBytes: value.byteLength }
  if (depth > 6) return "[nested]"
  if (Array.isArray(value)) return value.length > 24 ? { length: value.length, first: value.slice(0, 24).map(v => compact(v, depth + 1)) } : value.map(v => compact(v, depth + 1))
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "input").map(([key, v]) => [key, compact(v, depth + 1)]))
  return value
}
function state(instance: Data): Data {
  const child = instance.child
  return {
    class: instance.constructor.name, phase: instance.phase, attempt: instance.attempt,
    iterations: instance.iterations, maxIterations: instance.MAX_ITERATIONS,
    solved: instance.solved, failed: instance.failed, error: instance.error ?? null,
    currentTraceCount: instance.traces?.length ?? 0, canNegotiateGeneratedSites: instance.canNegotiateGeneratedSites,
    carrierStrategy: instance.carrierStrategy, stats: compact(instance.stats),
    activeGenerators: ["nativeSingleCarrier", "sharedPackages", "backwardPackages", "siteRematch", "packageCoupling", "surfaceFinishing", "multiTerminal", "finishing", "pendingExitSearch", "negotiated"].filter(name => !!instance[name]),
    child: child ? { class: child.constructor.name, phase: child.phase, attempt: child.attempt, lane: child.lane, activeConnection: child.search?.scene?.connection?.name ?? child.orders?.[child.attempt]?.[child.lane]?.name ?? null,
      iterations: child.iterations, maxIterations: child.MAX_ITERATIONS, solved: child.solved, failed: child.failed,
      error: child.error ?? null, failureCode: child.failureCode, congestionPass: child.congestionPass, conflictingLanes: child.conflictingLanes,
      activeGenerators: ["pendingExitSearch", "negotiated", "finishing", "repair"].filter(name => !!child[name]) } : null,
  }
}
function flush(force = false): void {
  const now = performance.now()
  if (!force && now - lastFlush < 10000) return
  lastFlush = now
  const checkpoint = { elapsedMs: now - startedAt, lastEvent, eventCounts, aggregates, domains, subpasses,
    generatedCalls, activePipelineId: stack.at(-1) ?? null, pipelines: instances.map((instance, id) => ({ id, ...state(instance) })),
    storedExamples: events.length, droppedExamples, observerErrors }
  writeFileSync(resolve(output, "checkpoint.json"), JSON.stringify(checkpoint) + "\n")
  if (checkpointCount++ < 1000) appendFileSync(resolve(output, "checkpoints.jsonl"), JSON.stringify({ elapsedMs: checkpoint.elapsedMs, lastEvent, pipelines: checkpoint.pipelines }) + "\n")
  writeFileSync(resolve(output, "events.json.gz"), gzipSync(JSON.stringify(events)))
}
function collect(eventType: string, details: Data = {}): void {
  try {
    const elapsedMs = performance.now() - startedAt, pipelineId = stack.at(-1) ?? null
    eventCounts[eventType] = (eventCounts[eventType] ?? 0) + 1
    const location = details.location ?? details
    const key = [eventType, pipelineId, details.name ?? location.name, details.layer ?? location.layer, details.alignSurfaceGrid ?? location.alignSurfaceGrid].join("|")
    const aggregate = aggregates[key] ??= { eventType, pipelineId, name: details.name ?? location.name, layer: details.layer ?? location.layer, alignSurfaceGrid: details.alignSurfaceGrid ?? location.alignSurfaceGrid, count: 0, totalMs: 0, maxMs: 0, maxCells: 0 }
    aggregate.count++
    if (typeof details.elapsedMs === "number") { aggregate.totalMs += details.elapsedMs; aggregate.maxMs = Math.max(aggregate.maxMs, details.elapsedMs) }
    if (typeof details.cells === "number") aggregate.maxCells = Math.max(aggregate.maxCells, details.cells)
    // Aggregate every event before limiting stored examples.
    lastEvent = { eventType, pipelineId, elapsedMs, name: details.name ?? location.name, layer: details.layer ?? location.layer, alignSurfaceGrid: details.alignSurfaceGrid ?? location.alignSurfaceGrid, maxLength: details.maxLength, explicitBounds: details.explicitBounds, cells: details.cells }
    if (eventType === "generated_sites:start") {
      const item = { id: details.call, pipelineId, startedMs: elapsedMs, input: compactInput(details.input), options: details.options, maxSteps: details.maxSteps }
      if (generatedCalls.length >= 32) generatedCalls.shift()
      generatedCalls.push(item)
    } else if (eventType === "generated_sites:return" || eventType === "generated_sites:cancelled_or_threw") {
      const call = generatedCalls.find(item => item.id === details.call)
      if (call) call.outcome = { ...details, eventType, elapsedMs }
    }
    if (eventType === "generated.subpass" || eventType === "generated.pass") {
      if (subpasses.length >= 32) subpasses.shift()
      subpasses.push({ ...details, pipelineId, elapsedMs, eventType })
    }
    if (eventType === "negotiation.begin") {
      const key = String(details.call)
      if (Object.keys(domains).length >= 32) delete domains[Object.keys(domains)[0]]
      domains[key] = { pipelineId, options: details.options, startMs: elapsedMs, names: Object.fromEntries(details.names.map((name: string) => [name, { status: "unvisited" }])) }
    } else if (details.call != null && details.name && domains[String(details.call)]) {
      domains[String(details.call)].names[details.name] = { ...domains[String(details.call)].names[details.name], status: eventType, elapsedMs, layer: details.layer, count: details.count, layers: details.layers }
    }
    if (events.length < 4000 && !["grid.attachments", "grid.attachments_cache", "grid.attachment_context"].includes(eventType)) {
      const copied = compact(details)
      if (eventType === "generated_sites:start") copied.input = generatedCalls.at(-1)?.input
      events.push({ ...copied, eventType, pipelineId, elapsedMs })
    } else droppedExamples++
    flush()
  } catch (error) { if (observerErrors.length < 20) observerErrors.push(String(error)) }
}
(globalThis as Data).__busDiag = collect
const wasmAttempts: string[] = [], importWasm: string[] = []
let importing = true
const guarded = new Set(["instantiate", "instantiateStreaming", "compile", "compileStreaming", "Module", "Instance", "Memory"])
const wrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(globalThis.WebAssembly, {
  get(target, key, receiver): unknown {
    const value = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return value
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => { if (importing) { importWasm.push(String(key)); return }; wasmAttempts.push(String(key)); throw new Error(`Routing WASM is forbidden: ${String(key)}`) }
    const wrapped = new Proxy(value, { apply(fn, receiver, arguments_): unknown { check(); return Reflect.apply(fn, receiver, arguments_) }, construct(fn, arguments_): object { check(); return Reflect.construct(fn, arguments_) } })
    wrappers.set(key, wrapped); return wrapped
  },
})
const exported = await import(pathToFileURL(modulePath).href)
importing = false
const Pipeline = exported.__busDiagPipeline
assert.equal(typeof Pipeline, "function")
const descriptor = Object.getOwnPropertyDescriptor(Pipeline.prototype, "_step")!
Object.defineProperty(Pipeline.prototype, "_step", { ...descriptor, value(this: Data, ...arguments_: unknown[]): unknown {
  let pushed = false
  try {
    let id = ids.get(this)
    if (id === undefined) {
      id = instances.length
      const initial = { id, parentId: stack.at(-1) ?? null, input: compactInput(this.input), routingInput: compactInput(this.routingInput), options: structuredClone(this.options), initialMaxIterations: this.MAX_ITERATIONS }
      ids.set(this, id); instances.push(this); pipelines.push(initial)
    }
    stack.push(id); pushed = true
  } catch (error) { if (observerErrors.length < 20) observerErrors.push(String(error)) }
  try { return descriptor.value.apply(this, arguments_) }
  finally { if (pushed) stack.pop() }
} })
const adapted = exported.__busDiagAdapt(input)
const adaptedBeforeSha256 = hash(JSON.stringify(adapted))
const solver = new Pipeline(adapted)
let captureDeadlineReached = false
startedAt = performance.now()
writeFileSync(resolve(output, "start-proof.json"), JSON.stringify({ rawInputSha256: hash(inputBytes), adaptedBeforeSha256, coreSha256: core.entrySha256, observerSha256: hash(readFileSync(modulePath)), nativeOptions: {}, routingBudgetsChanged: false }) + "\n")
try {
  while (!solver.solved && !solver.failed) {
    for (let count = 0; count < 200 && !solver.solved && !solver.failed; count++) solver.step()
    flush()
    if (performance.now() - startedAt >= 900000) { captureDeadlineReached = true; break }
    await new Promise<void>(done => setImmediate(done))
  }
} catch (error) { executionError = String(error) }
finally {
  flush(true)
  Object.defineProperty(Pipeline.prototype, "_step", descriptor)
  delete (globalThis as Data).__busDiag
  const report = { scope: "Single observed native phase2 replay; diagnostics only, no performance or full-board completion claim", elapsedMs: performance.now() - startedAt,
    mainVersion: manifest.mainVersion, coreVersion: core.version, originalEntrySha256: core.entrySha256,
    diagnosticEntrySha256: hash(readFileSync(modulePath)), rawInputSha256: hash(inputBytes), canonicalRawInputBeforeSha256, canonicalRawInputAfterSha256: hash(JSON.stringify(input)), adaptedBeforeSha256, adaptedAfterSha256: hash(JSON.stringify(adapted)),
    nativeOptions: {}, routingBudgetsChanged: false, captureDeadlineReached, executionError, observerErrors, wasmAttempts, importWasm,
    solved: solver.solved, failed: solver.failed, error: solver.error ?? null, nativeNames, eventCounts, aggregates, domains, subpasses, generatedCalls, droppedExamples,
    pipelines: pipelines.map((initial, id) => ({ ...initial, final: state(instances[id]), currentTracesSha256: hash(JSON.stringify(instances[id].traces)) })), diagnosticMetadata: exported.busDiagMetadata }
  if (solver.solved) {
    const result = solver.getOutput()
    const bytes = Buffer.from(JSON.stringify(result))
    writeFileSync(resolve(output, "completed-output.srj.json.gz"), gzipSync(bytes))
    Object.assign(report, { outputSha256: hash(bytes), outputNeedsPhysicalValidation: true })
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify({ solved: solver.solved, failed: solver.failed, captureDeadlineReached, executionError, observerErrors, pipelines: report.pipelines.map(p => ({ id: p.id, final: p.final })), generatedCalls }))
}
assert.equal(hash(readFileSync(core.entry)), core.entrySha256)
assert.equal(executionError, null)
assert.deepEqual(observerErrors, [])
assert.deepEqual(exported.busDiagMetadata.errors, [])
assert.deepEqual(wasmAttempts, [])
