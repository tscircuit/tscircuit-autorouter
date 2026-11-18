import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

type RecordData = Record<string, any>
const [moduleArgument, outputArgument, mode, manifestArgument] = process.argv.slice(2)
assert(moduleArgument && outputArgument && manifestArgument)
assert(mode === "control" || mode === "observed")
const modulePath = resolve(moduleArgument)
const output = resolve(outputArgument)
const laneOutput = resolve(output, mode)
mkdirSync(laneOutput, { recursive: true })
const hash = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex")
const manifest = JSON.parse(readFileSync(manifestArgument, "utf8"))
const core = manifest.packages.find((entry: RecordData) => entry.name === "@tscircuit/core")
assert.equal(manifest.mainVersion, "0.0.3234")
assert.equal(core.version, "0.0.2414")
assert.equal(manifest.sourceOverrides, false)
assert.deepEqual(manifest.dependencyOverrides, [])
assert.equal(hash(readFileSync(core.entry)), core.entrySha256)
assert.equal(Bun.version, "1.4.3")
assert.equal(process.arch, "arm64")
const inputBytes = gunzipSync(readFileSync(resolve(output, "phase-2-input.srj.json.gz")))
assert.equal(hash(inputBytes), "76cf820b7c60096fc5b71779a232f5b297567ed62a56cf2b22f3d675d863b92e")
const input = JSON.parse(inputBytes.toString())
const historical = JSON.parse(readFileSync(resolve(output, "bus-byte1-lifecycle.json"), "utf8"))
const diagnostics: RecordData[] = []
const eventCounts: Record<string, number> = {}
const observerErrors: string[] = []
const rasters: RecordData[] = []
const generatedCalls: RecordData[] = []
const pipelines: RecordData[] = []
let eventOverflow = false
let firstFallbackReturned = false
let startedAt = 0
let activeGenerated: RecordData | undefined
const point = (value: RecordData): RecordData => ({
  x: value.x, y: value.y, layer: value.layer,
  pointId: value.pointId ?? null, pcb_port_id: value.pcb_port_id ?? null,
})
function compactInput(value: RecordData): RecordData {
  return {
    sha256: hash(JSON.stringify(value)),
    obstacleCount: value.obstacles.length,
    fixedTraceCount: value.traces?.length ?? 0,
    connections: value.connections.map((connection: RecordData) => ({
      name: connection.name, source_trace_id: connection.source_trace_id ?? null,
      terminals: connection.pointsToConnect.map(point),
    })),
  }
}
function collect(kind: string, details: RecordData = {}): void {
  try {
    eventCounts[kind] = (eventCounts[kind] ?? 0) + 1
    if (kind === "generated_sites:start") {
      activeGenerated = {
        id: generatedCalls.length, input: compactInput(details.input),
        options: structuredClone(details.options), maxSteps: details.maxSteps,
      }
      generatedCalls.push(activeGenerated)
      diagnostics.push({ kind, ...activeGenerated })
      return
    }
    if (kind === "generated_sites:return") {
      assert(activeGenerated)
      const { call: _observationCall, ...outcome } = details
      activeGenerated.outcome = structuredClone(outcome)
      firstFallbackReturned = true
    }
    const copied: RecordData = {}
    for (const [key, value] of Object.entries(details)) {
      if (ArrayBuffer.isView(value)) {
        // Read the raster once without asking the live lazy component cache
        // additional questions. Full connectivity analysis happens offline.
        if (rasters.length < 4 && details.name === "source_net_281" && details.call != null) {
          const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
          const snapshot = Buffer.from(bytes)
          const filename = `first-lane-raster-${rasters.length}.bin.gz`
          rasters.push({ filename, bytes: snapshot.length, sha256: hash(snapshot), data: snapshot, call: details.call, search: details.search, layer: details.layer, nx: details.nx, ny: details.ny, start: details.start, end: details.end, starts: details.starts, ends: details.ends })
          copied[key] = { file: filename, bytes: snapshot.length, sha256: hash(snapshot) }
        } else copied[key] = { omittedTypedArray: true, bytes: value.byteLength }
      } else copied[key] = value
    }
    if (diagnostics.length < 100000) diagnostics.push({ kind, ...structuredClone(copied) })
    else eventOverflow = true
  } catch (error) {
    if (observerErrors.length < 20) observerErrors.push(String(error))
  }
}
(globalThis as RecordData).__busDiag = collect

const wasmAttempts: string[] = []
const importWasm: string[] = []
let importing = true
const guarded = new Set(["instantiate", "instantiateStreaming", "compile", "compileStreaming", "Module", "Instance", "Memory"])
const wrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(globalThis.WebAssembly, {
  get(target, key, receiver): unknown {
    const value = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return value
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => {
      if (importing) { importWasm.push(String(key)); return }
      wasmAttempts.push(String(key))
      throw new Error(`Routing WASM is forbidden: ${String(key)}`)
    }
    const wrapped = new Proxy(value, {
      apply(fn, receiver, arguments_): unknown { check(); return Reflect.apply(fn, receiver, arguments_) },
      construct(fn, arguments_): object { check(); return Reflect.construct(fn, arguments_) },
    })
    wrappers.set(key, wrapped)
    return wrapped
  },
})
const exported = await import(pathToFileURL(modulePath).href)
importing = false
assert.equal(typeof exported.__busDiagPipeline, "function")
assert.equal(typeof exported.__busDiagAdapt, "function")
const Pipeline = exported.__busDiagPipeline
const descriptor = Object.getOwnPropertyDescriptor(Pipeline.prototype, "_step")!
assert.equal(typeof descriptor.value, "function")
const ids = new WeakMap<object, number>()
const instances: RecordData[] = []
const stack: number[] = []
Object.defineProperty(Pipeline.prototype, "_step", {
  ...descriptor,
  value(this: RecordData, ...arguments_: unknown[]): unknown {
    let id = ids.get(this)
    if (id === undefined) {
      id = pipelines.length
      ids.set(this, id)
      instances.push(this)
      pipelines.push({
        id, parentId: stack.at(-1) ?? null, input: compactInput(this.input),
        routingInput: compactInput(this.routingInput), options: structuredClone(this.options),
        initialMaxIterations: this.MAX_ITERATIONS, calls: 0,
      })
    }
    pipelines[id].calls++
    stack.push(id)
    try { return descriptor.value.apply(this, arguments_) }
    finally { stack.pop() }
  },
})
const adapted = exported.__busDiagAdapt(input)
const solver = new Pipeline(adapted)
assert.equal(solver.iterations, 0)
let executionError: string | null = null
let captureDeadlineReached = false
startedAt = performance.now()
try {
  while (!solver.solved && !solver.failed && !firstFallbackReturned) {
    for (let count = 0; count < 200 && !solver.solved && !solver.failed && !firstFallbackReturned; count++) solver.step()
    if (performance.now() - startedAt > 900000) { captureDeadlineReached = true; break }
    await new Promise<void>((done) => setImmediate(done))
  }
} catch (error) { executionError = String(error) }
finally {
  Object.defineProperty(Pipeline.prototype, "_step", descriptor)
  delete (globalThis as RecordData).__busDiag
  for (const [index, instance] of instances.entries()) {
    pipelines[index].final = {
      phase: instance.phase, iterations: instance.iterations,
      MAX_ITERATIONS: instance.MAX_ITERATIONS, solved: instance.solved,
      failed: instance.failed, error: instance.error ?? null,
      acceptedTraceCount: instance.traces.length,
      acceptedTracesSha256: hash(JSON.stringify(instance.traces)),
    }
  }
  for (const raster of rasters) {
    const components = new exported.__busDiagGridComponents(new Uint8Array(raster.data), raster.nx)
    const attachments = diagnostics.filter((event) => event.search === raster.search && ["grid.attachments", "grid.attachments_cache"].includes(event.kind))
    const atEndpoint = (record: RecordData, endpoint: RecordData): boolean => Math.abs(record.point.x - endpoint.x) < 1e-9 && Math.abs(record.point.y - endpoint.y) < 1e-9
    const startAttachments = attachments.find((event) => atEndpoint(event, raster.start))
    const endAttachments = attachments.find((event) => atEndpoint(event, raster.end))
    const componentIds = (ids: number[]): number[] => [...new Set(ids.map((id) => components.at(id)).filter(Boolean))] as number[]
    const retainedStarts = componentIds(raster.starts)
    const retainedEnds = componentIds(raster.ends)
    const allStarts = startAttachments?.candidates ? componentIds(startAttachments.candidates.map((item: RecordData) => item.id)) : null
    const allEnds = endAttachments?.candidates ? componentIds(endAttachments.candidates.map((item: RecordData) => item.id)) : null
    raster.offlineAttachmentComponents = {
      retainedStarts, retainedEnds, allStarts, allEnds,
      retainedShared: retainedStarts.filter((id) => retainedEnds.includes(id)),
      untruncatedShared: allStarts && allEnds ? allStarts.filter((id) => allEnds.includes(id)) : null,
      scope: "Offline native occupancy-component comparison; shared components do not prove exact-edge route feasibility",
    }
    raster.constructorFailure = diagnostics.find((event) => event.search === raster.search && event.kind === "grid.constructor_failed") ?? null
    raster.searchOutcomes = diagnostics.filter((event) => event.searchId === raster.search)
    writeFileSync(resolve(laneOutput, raster.filename), gzipSync(raster.data))
    delete raster.data
  }
  const compareHistorical = (index: number): boolean => {
    const previous = historical.instances[index]?.input
    const current = pipelines[index]?.input
    if (!previous || !current) return false
    const { sha256: _digest, ...compact } = current
    return JSON.stringify(compact) === JSON.stringify(previous)
  }
  const report = {
    mode, scope: "Diagnostic exact phase-input replay; stopped after the first fallback; no completed-board claim",
    mainVersion: manifest.mainVersion, coreVersion: core.version,
    originalEntrySha256: core.entrySha256, diagnosticEntrySha256: hash(readFileSync(modulePath)),
    rawInputSha256: hash(inputBytes), adaptedInputSha256: hash(JSON.stringify(adapted)),
    elapsedMs: performance.now() - startedAt, firstFallbackReturned,
    captureDeadlineReached, executionError, observerErrors, eventOverflow,
    wasmAttempts, importWasm, eventCounts, generatedCalls, pipelines, rasters,
    diagnosticMetadata: exported.busDiagMetadata,
    historicalRootAndTrunkMatch: [compareHistorical(0), compareHistorical(1)],
    routingBudgetsChanged: false,
  }
  writeFileSync(resolve(laneOutput, "report.json"), JSON.stringify(report, null, 2) + "\n")
  writeFileSync(resolve(laneOutput, "events.json.gz"), gzipSync(JSON.stringify(diagnostics)))
  console.log(JSON.stringify({ mode, firstFallbackReturned, captureDeadlineReached, executionError, observerErrors, eventOverflow, generatedCalls, historicalRootAndTrunkMatch: report.historicalRootAndTrunkMatch }))
}
assert(firstFallbackReturned, "First generated-sites fallback did not return within diagnostic capture")
assert.equal(executionError, null)
assert.deepEqual(observerErrors, [])
assert.deepEqual(exported.busDiagMetadata.errors, [])
assert.equal(eventOverflow, false)
assert.deepEqual(wasmAttempts, [])
