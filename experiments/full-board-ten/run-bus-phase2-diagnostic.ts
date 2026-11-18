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
assert.equal(manifest.mainVersion, "0.0.3236")
assert.equal(core.version, "0.0.2418")
assert.equal(core.entrySha256, "a02e5e4378214bd37bb0bdb2a59ec681b0ef400a58d553038755250f08875176")
assert.equal(hash(readFileSync(core.entry)), core.entrySha256)
assert.equal(manifest.routingSourceOverride.sourceCandidateCommit, "520dd0fb4f7264ffa597782aff7f91313f5a78b9")
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
let child2CaptureAttempted = false
let child2Geometry: Data | null = null
let child1Accepted: Data | null = null
let child2OrdinaryStepCalls = 0
const nativeNames = input.connections.map((connection: Data) => connection.name)
const point = (value: Data): Data => ({ x: value.x, y: value.y, layer: value.layer, layers: value.layers, pointId: value.pointId ?? null, pcb_port_id: value.pcb_port_id ?? null })
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
    activity: child?.pendingExitSearch ? "pending-guide-generation" : instance.surfaceFinishing ? "generated-site-fallback" : child?.negotiated ? "negotiated-lane-routing" : child?.search ? "ordinary-lane-search" : instance.multiTerminal ? "multi-terminal-children" : "pipeline-preparation-or-other",
    class: instance.constructor.name, phase: instance.phase, attempt: instance.attempt,
    iterations: instance.iterations, maxIterations: instance.MAX_ITERATIONS,
    solved: instance.solved, failed: instance.failed, error: instance.error ?? null,
    currentTraceCount: instance.traces?.length ?? 0, canNegotiateGeneratedSites: instance.canNegotiateGeneratedSites,
    carrierStrategy: instance.carrierStrategy, stats: compact(instance.stats),
    activeGenerators: ["nativeSingleCarrier", "sharedPackages", "backwardPackages", "siteRematch", "packageCoupling", "surfaceFinishing", "multiTerminal", "finishing", "pendingExitSearch", "negotiated"].filter(name => !!instance[name]),
    child: child ? { class: child.constructor.name, phase: child.phase, attempt: child.attempt, lane: child.lane, activeConnection: child.search?.scene?.connection?.name ?? child.orders?.[child.attempt]?.[child.lane]?.name ?? null,
      search: child.search ? { class: child.search.constructor.name, expanded: child.search.expanded, solved: child.search.solved, failed: child.search.failed } : null,
      iterations: child.iterations, maxIterations: child.MAX_ITERATIONS, solved: child.solved, failed: child.failed,
      error: child.error ?? null, failureCode: child.failureCode, congestionPass: child.congestionPass, conflictingLanes: child.conflictingLanes,
      activeGenerators: ["pendingExitSearch", "negotiated", "finishing", "repair"].filter(name => !!child[name]) } : null,
  }
}
function captureAcceptedChild1(bytes?: Buffer): void {
  try {
    const first = instances[1]
    if (!first?.solved || first.failed || child1Accepted) return
    const acceptedBytes = bytes ?? Buffer.from(JSON.stringify(first.getOutput()))
    writeFileSync(resolve(output, "solved-child1-output.srj.json.gz"), gzipSync(acceptedBytes))
    child1Accepted = { pipelineId: 1, elapsedMs: performance.now() - startedAt, outputSha256: hash(acceptedBytes), solved: true, failed: false, currentTraceCount: first.traces.length }
    writeFileSync(resolve(output, "child1-accepted-proof.json"), JSON.stringify(child1Accepted) + "\n")
  } catch (error) { if (observerErrors.length < 20) observerErrors.push(String(error)) }
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
function selectedSummary(value: Data): Data {
  return { name: value.connection?.name, layer: value.layer, pendingCost: value.pendingCost, score: value.score,
    vias: (value.escapes ?? []).flatMap((trace: Data) => trace.route.filter((p: Data) => p.route_type === "via").map((p: Data) => ({ x: p.x, y: p.y, layers: p.layers, diameter: p.via_diameter, hole: p.via_hole_diameter }))) }
}
function collect(eventType: string, details: Data = {}): void {
  try {
    const elapsedMs = performance.now() - startedAt, pipelineId = stack.at(-1) ?? null
    eventCounts[eventType] = (eventCounts[eventType] ?? 0) + 1
    const key = [eventType, pipelineId, details.name].join("|")
    const aggregate = aggregates[key] ??= { eventType, pipelineId, name: details.name, count: 0, totalMs: 0, maxMs: 0, positiveCosts: 0, maxCost: 0, sampledZero: 0, sampledPositive: 0 }
    aggregate.count++
    if (typeof details.elapsedMs === "number") { aggregate.totalMs += details.elapsedMs; aggregate.maxMs = Math.max(aggregate.maxMs, details.elapsedMs) }
    // Count every actual callback; inspect copper only for bounded examples.
    if (eventType === "pending.cost") {
      const positive = details.cost > 0
      aggregate.positiveCosts += Number(positive)
      aggregate.maxCost = Math.max(aggregate.maxCost, details.cost)
      const sampleKey = positive ? "sampledPositive" : "sampledZero"
      if (aggregate[sampleKey] >= 4) { droppedExamples++; flush(); return }
      aggregate[sampleKey]++
      const disks = details.copper.filter((c: Data) => c.layer === "top" && c.a.x === c.b.x && c.a.y === c.b.y)
      details = { name: details.name, cost: details.cost, foreignGuideGroups: details.foreignGuideGroups, copperCount: details.copper.length,
        topDisks: disks.slice(0, 8).map((c: Data) => ({ x: c.a.x, y: c.a.y, radius: c.radius })) }
    } else if (eventType === "pending_guides:return") {
      const guides = details.result
      details = { ...details, result: undefined, guideCount: guides.length,
        activeGuideCounts: Object.fromEntries(nativeNames.map((name: string) => [name, guides.filter((guide: Data) => guide.owners.includes(name)).length])) }
    } else if (eventType === "generated_sites:return") {
      const result = details.result
      details = { ...details, result: undefined, returned: !!result, carriers: result?.carriers.length ?? 0, traces: result?.traces.length ?? 0, escapes: result?.escapes.length ?? 0 }
    } else if (eventType === "pending.active_branches") {
      details = { count: details.connections.length, branches: details.connections.slice(0, 32).map((c: Data) => ({ name: c.name, start: point(c.pointsToConnect[0]), goalCount: c.pointsToConnect.length - 1 })) }
    } else if (eventType === "pending.active_paths") {
      details = { count: details.traces.length, paths: details.traces.slice(0, 32).map((t: Data) => ({ name: t.connection_name, pointCount: t.route.length, start: point(t.route[0]), end: point(t.route.at(-1)) })) }
    } else if (eventType === "sites.selected") {
      details = { call: details.call, ...selectedSummary(details.selected) }
    } else if (eventType === "sites.finish") {
      details = { call: details.call, selected: details.selected.map(selectedSummary) }
    }
    lastEvent = { eventType, pipelineId, elapsedMs, name: details.name, call: details.call }
    if (eventType.endsWith(":start") && ["pending_guides:start", "generated_sites:start"].includes(eventType)) {
      if (generatedCalls.length >= 64) generatedCalls.shift()
      generatedCalls.push({ ...details, eventType, pipelineId, startedMs: elapsedMs })
    } else if (eventType.endsWith(":return") || eventType.endsWith(":cancelled_or_threw")) {
      const call = generatedCalls.find(item => item.call === details.call)
      if (call) call.outcome = { ...details, eventType, elapsedMs }
    }
    if (eventType === "sites.begin") {
      if (Object.keys(domains).length >= 32) delete domains[Object.keys(domains)[0]]
      domains[String(details.call)] = { pipelineId, startMs: elapsedMs, names: Object.fromEntries(details.names.map((name: string) => [name, { status: "unvisited" }])) }
    } else if (eventType === "sites.domain" && domains[String(details.call)]) {
      domains[String(details.call)].names[details.name] = { status: "domain-built", count: details.choiceCount, elapsedMs }
    }
    if (events.length < 2000) events.push({ ...compact(details), eventType, pipelineId, elapsedMs })
    else droppedExamples++
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
      if (id === 2) {
        child2CaptureAttempted = true
        const first = instances[1]
        assert.equal(initial.parentId, 0, "Expected direct second multi-terminal child")
        assert(first.solved && !first.failed, "First native child must already be solved")
        const childInput = Buffer.from(JSON.stringify(this.input))
        const routingInput = Buffer.from(JSON.stringify(this.routingInput))
        const firstOutput = Buffer.from(JSON.stringify(first.getOutput()))
        captureAcceptedChild1(firstOutput)
        const inputSha256 = hash(childInput), routingInputSha256 = hash(routingInput)
        writeFileSync(resolve(output, "child2-input.srj.json.gz"), gzipSync(childInput))
        if (routingInputSha256 !== inputSha256) writeFileSync(resolve(output, "child2-routing-input.srj.json.gz"), gzipSync(routingInput))
        writeFileSync(resolve(output, "solved-child1-output.srj.json.gz"), gzipSync(firstOutput))
        child2Geometry = { pipelineId: id, parentId: initial.parentId, elapsedMs: performance.now() - startedAt,
          inputSha256, routingInputSha256, firstChildOutputSha256: hash(firstOutput), firstChildSolved: first.solved,
          inputTraceCount: this.input.traces.length, inputConnectionCount: this.input.connections.length,
          options: structuredClone(this.options), capturedBeforeFirstChild2Step: true }
        writeFileSync(resolve(output, "child2-geometry-proof.json"), JSON.stringify(child2Geometry, null, 2) + "\n")
        assert.equal(this.input.connections.length, nativeNames.length)
        assert(child1Accepted && child1Accepted.outputSha256 === hash(firstOutput))
      }
    }
    stack.push(id); pushed = true
  } catch (error) { if (observerErrors.length < 20) observerErrors.push(String(error)) }
  if (ids.get(this) === 2) child2OrdinaryStepCalls++
  try { return descriptor.value.apply(this, arguments_) }
  finally {
    try {
      if (ids.get(this) === 2 && child2Geometry) {
        assert(this.child?.input, "Second child must expose its prepared lane input")
        const laneInput = Buffer.from(JSON.stringify(this.child.input))
        writeFileSync(resolve(output, "child2-lane-input.srj.json.gz"), gzipSync(laneInput))
        const parameters = { options: this.child.options, terminalLayers: [...this.child.terminalLayers],
          pipelineTerminalLayers: [...this.terminalLayers], canNegotiateGeneratedSites: this.canNegotiateGeneratedSites,
          pipelinePhase: this.phase, childPhase: this.child.phase, childIterations: this.child.iterations,
          childMaxIterations: this.child.MAX_ITERATIONS, childUseNegotiation: this.child.useNegotiation,
          escapes: this.escapes, capturedAfterFirstPipelineStep: true }
        const parameterBytes = Buffer.from(JSON.stringify(parameters))
        writeFileSync(resolve(output, "child2-lane-parameters.json"), parameterBytes)
        Object.assign(child2Geometry, { laneInputSha256: hash(laneInput), laneParameterSha256: hash(parameterBytes),
          laneInputTraceCount: this.child.input.traces.length, preparedLaneCaptured: true, ordinaryStepCalls: child2OrdinaryStepCalls })
        writeFileSync(resolve(output, "child2-geometry-proof.json"), JSON.stringify(child2Geometry, null, 2) + "\n")
      }
    } catch (error) { if (observerErrors.length < 20) observerErrors.push(String(error)) }
    if (pushed) stack.pop()
  }
} })
const adapted = exported.__busDiagAdapt(input)
const adaptedBeforeSha256 = hash(JSON.stringify(adapted))
const solver = new Pipeline(adapted)
let captureDeadlineReached = false
startedAt = performance.now()
writeFileSync(resolve(output, "start-proof.json"), JSON.stringify({ rawInputSha256: hash(inputBytes), adaptedBeforeSha256, coreSha256: core.entrySha256, observerSha256: hash(readFileSync(modulePath)), nativeOptions: {}, routingBudgetsChanged: false, externalDiagnosticWindowMs: 900000, fullBoardRemainingBudgetEquivalent: false }) + "\n")
try {
  while (!solver.solved && !solver.failed && !instances[1]?.failed && !child2CaptureAttempted) {
    for (let count = 0; count < 200 && !solver.solved && !solver.failed && !instances[1]?.failed && !child2CaptureAttempted; count++) {
      solver.step()
      captureAcceptedChild1()
    }
    flush()
    if (performance.now() - startedAt >= 900000) { captureDeadlineReached = true; break }
    await new Promise<void>(done => setImmediate(done))
  }
} catch (error) { executionError = String(error) }
finally {
  flush(true)
  Object.defineProperty(Pipeline.prototype, "_step", descriptor)
  delete (globalThis as Data).__busDiag
  const report = { scope: "Isolated phase capture with a diagnostic900s external guard, not the full-board remaining668s budget; stop after firstchild failure or secondchild preparation; no performance or completion claim", elapsedMs: performance.now() - startedAt,
    mainVersion: manifest.mainVersion, coreVersion: core.version, originalEntrySha256: core.entrySha256,
    diagnosticEntrySha256: hash(readFileSync(modulePath)), rawInputSha256: hash(inputBytes), canonicalRawInputBeforeSha256, canonicalRawInputAfterSha256: hash(JSON.stringify(input)), adaptedBeforeSha256, adaptedAfterSha256: hash(JSON.stringify(adapted)),
    nativeOptions: {}, routingBudgetsChanged: false, externalDiagnosticWindowMs: 900000, fullBoardRemainingBudgetEquivalent: false, child1Accepted, child2OrdinaryStepCalls, child2CaptureAttempted, child2Geometry, captureDeadlineReached, executionError, observerErrors, wasmAttempts, importWasm,
    solved: solver.solved, failed: solver.failed, error: solver.error ?? null, nativeNames, eventCounts, aggregates, domains, subpasses, generatedCalls, droppedExamples,
    pipelines: pipelines.map((initial, id) => ({ ...initial, final: state(instances[id]), currentTracesSha256: hash(JSON.stringify(instances[id].traces)) })), diagnosticMetadata: exported.busDiagMetadata }
  if (solver.solved) {
    const result = solver.getOutput()
    const bytes = Buffer.from(JSON.stringify(result))
    writeFileSync(resolve(output, "completed-output.srj.json.gz"), gzipSync(bytes))
    Object.assign(report, { outputSha256: hash(bytes), outputNeedsPhysicalValidation: true })
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2) + "\n")
  console.log(JSON.stringify({ solved: solver.solved, failed: solver.failed, child2CaptureAttempted, child2Geometry, captureDeadlineReached, executionError, observerErrors, pipelines: report.pipelines.map(p => ({ id: p.id, final: p.final })), generatedCalls }))
}
assert.equal(hash(readFileSync(core.entry)), core.entrySha256)
assert.equal(executionError, null)
assert.deepEqual(observerErrors, [])
assert.deepEqual(exported.busDiagMetadata.errors, [])
assert.deepEqual(wasmAttempts, [])
