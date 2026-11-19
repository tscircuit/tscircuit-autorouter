import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gzipSync, gunzipSync } from "node:zlib"
import { createCoarseRoutingDiagnostics } from "./createCoarseRoutingDiagnostics"

const [casePath, output, executionMode = "full"] = process.argv.slice(2)
if (!["full", "geometry"].includes(executionMode)) throw new Error("Execution mode must be full or geometry")
if (!casePath || !output) throw new Error("Usage: render-published.tsx CASE.json OUTPUT")
const task = JSON.parse(readFileSync(casePath, "utf8"))
if (task.mode !== "phased" || task.fanout !== false || !["original", "spaced"].includes(task.cohort)) throw new Error("Ten-case cohort requires explicit original/spaced phased mode, fanout=false")
task.sourcePath = resolve(task.sourcePath)
const sourceBytes = readFileSync(task.sourcePath)
const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex")
if (sha(sourceBytes) !== task.sourceSha256) throw new Error("Authoritative full-board source changed")
const rawSource = JSON.parse((task.sourcePath.endsWith(".gz") ? gunzipSync(sourceBytes) : sourceBytes).toString())
const layout = task.cohort === "spaced" ? await import(pathToFileURL(resolve(task.layoutModule)).href) : null
const source = layout ? layout.createPeripheralLayout(rawSource) : rawSource
for (const file of task.implementationFiles) if (sha(readFileSync(file.path)) !== file.sha256) throw new Error(`Authoritative circuit implementation changed: ${file.path}`)
if (task.cohort === "original" && source.planeIntent.savedCopperImported) throw new Error("Fresh original case must not import saved copper")
mkdirSync(output, { recursive: true })

// Normal published geometry uses Manifold. Routing/unknown WASM stays forbidden.
const wasmUsage = { coldMainImportCalls: 0, coldMainImportStacks: [] as { package: string; stack: string }[], geometryCalls: 0, routingOrUnknownAttempts: 0, geometryStacks: [] as string[] }
let importingPublishedMain = true
const copperModule = fileURLToPath(import.meta.resolve("@tscircuit/copper-pour-solver"))
const geometryModuleOrigins = [...new Set([import.meta.dir, dirname(copperModule)].flatMap(context => ["@tscircuit/manifold-2d", "@tscircuit/manifold-2d/manifold"].flatMap(name => {
  const path = Bun.resolveSync(name, context)
  return [path, realpathSync(path)]
})))]
const guarded = new Set(["Module", "Instance", "Memory", "compile", "instantiate", "compileStreaming", "instantiateStreaming"])
const nativeWasm = globalThis.WebAssembly
const wrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(nativeWasm, {
  get(target, key, receiver): unknown {
    const value = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return value
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => {
      const stack = new Error().stack ?? ""
      if (importingPublishedMain) {
        wasmUsage.coldMainImportCalls++
        if (wasmUsage.coldMainImportStacks.length < 6) wasmUsage.coldMainImportStacks.push({ package: /krt-wasm/.test(stack) ? "@tscircuit/krt-wasm" : geometryModuleOrigins.some(origin => stack.includes(origin)) ? "@tscircuit/manifold-2d" : "unknown published import dependency", stack })
        return
      }
      if (!geometryModuleOrigins.some(origin => stack.includes(origin)) || /krt-wasm|krt_wasm/i.test(stack)) {
        wasmUsage.routingOrUnknownAttempts++
        throw new Error("Routing or unknown WebAssembly is disabled for the full-board cohort")
      }
      wasmUsage.geometryCalls++
      if (wasmUsage.geometryStacks.length < 3) wasmUsage.geometryStacks.push(stack)
    }
    const wrapped = new Proxy(value, {
      apply(fn, thisArg, args): unknown { check(); return Reflect.apply(fn, thisArg, args) },
      construct(fn, args): object { check(); return Reflect.construct(fn, args) },
    })
    wrappers.set(key, wrapped)
    return wrapped
  },
})
// Both lanes use native package resolution; the candidate declares its autorouter overlay.
if (!task.runtimeManifestPath) throw new Error("Explicit published runtime identity manifest required")
const runtimeManifest = JSON.parse(readFileSync(task.runtimeManifestPath, "utf8"))
const expectedRuntime = runtimeManifest.packages
if (JSON.stringify(task.routingSourceOverride ?? null) !== JSON.stringify(runtimeManifest.routingSourceOverride ?? null)) throw new Error("Routing source override identity differs from manifest")
const expectedNames = ["tscircuit", "@tscircuit/core", "@tscircuit/eval", "@tscircuit/capacity-autorouter"]
if (expectedRuntime.length !== 4 || expectedNames.some(name => !expectedRuntime.some((row: any) => row.name === name))) throw new Error("Runtime manifest must identify the complete compatible four-package chain")
const runtime = expectedRuntime.map(({ name, version, entrySha256 }: { name: string; version: string; entrySha256: string }) => {
  const entry = fileURLToPath(import.meta.resolve(name))
  let folder = dirname(entry)
  while (!readablePackage(folder, name)) {
    if (dirname(folder) === folder) throw new Error(`Missing package metadata for ${name}`)
    folder = dirname(folder)
  }
  const pkg = JSON.parse(readFileSync(join(folder, "package.json"), "utf8"))
  if (pkg.version !== version || sha(readFileSync(entry)) !== entrySha256) throw new Error(`Published runtime identity mismatch for ${name}`)
  return { name, version, entry, entrySha256, gitHead: pkg.gitHead }
})
function readablePackage(folder: string, name: string): boolean {
  try { return JSON.parse(readFileSync(join(folder, "package.json"), "utf8")).name === name }
  catch (error: any) { if (error.code === "ENOENT") return false; throw error }
}
const { RootCircuit, SOLVERS } = await import("tscircuit")
const { RootCircuit: SelectedRootCircuit } = await import("@tscircuit/core")
importingPublishedMain = false
const { AutoroutingPipelineSolver9_PreloadedTraceGraph: PublishedPipeline9 } = await import("@tscircuit/capacity-autorouter")
if (RootCircuit !== SelectedRootCircuit || SOLVERS.AutoroutingPipelineSolver9_PreloadedTraceGraph !== PublishedPipeline9) throw new Error("Main package did not select the authenticated Core/autorouter classes")
const { default: SourceBoard } = await import(pathToFileURL(resolve(task.boardModule)).href)
const { convertCircuitJsonToPcbSvg } = await import("circuit-to-svg")
const circuit = new RootCircuit({ platform: { localCacheEngine: undefined, routingDisabled: executionMode === "geometry" } })
const started = performance.now()
const progress: any = {
  ...task, executionMode, status: "running", renderCompleted: false, errors: [], phases: [], solvers: [],
  forbiddenRoutingSolverSelections: [],
  elapsedMs: 0, expectedGroups: task.cohort === "original" ? [...new Set(source.nets.map(net => net.group))] : ["byte0", "byte1", "remaining", "other_signals", "power"],
  runtime: { packages: runtime, candidateOverride: (task.dependencyOverrides?.length ?? 0) > 0, routingSourceOverride: task.routingSourceOverride ?? null, cacheEngine: false },
  planeIntent: { enabled: task.cohort === "original", authoredZones: task.cohort === "original" ? source.planeIntent.zones.length : 0, savedCopperImported: false },
}
const atomic = (name: string, value: Uint8Array | string): void => {
  writeFileSync(join(output, `${name}.tmp`), value)
  renameSync(join(output, `${name}.tmp`), join(output, name))
}
let lastCircuitSave = -Infinity
const save = (withCircuit = false): void => {
  progress.elapsedMs = performance.now() - started
  progress.wasmUsage = wasmUsage
  if (withCircuit || performance.now() - lastCircuitSave >= 15000) {
    const json = circuit.getCircuitJson()
    atomic("circuit.json.gz", gzipSync(JSON.stringify(json), { level: 1 }))
    progress.partialCounts = Object.fromEntries(["source_component", "source_net", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_trace", "pcb_via", "pcb_copper_pour"].map(type => [type, json.filter(item => item.type === type).length]))
    lastCircuitSave = performance.now()
  }
  atomic("progress.json", JSON.stringify(progress, null, 2))
}
const running = (): any => progress.phases.findLast((phase: any) => phase.status === "running")
const diagnosticTargets: Record<string, string> = {
  "butterstick-original": "plane_escape", "icepi-original": "plane_escape",
  "glider-spaced": "other_signals", "imx6-spaced": "remaining", "butterstick-spaced": "*",
}
const targetPhase: string | undefined = undefined
progress.coarseRoutingInstrumentation = { enabled: Boolean(targetPhase), targetPhase: targetPhase ?? null, mode: "observational published-instance lifecycle hooks" }
const coarseReports: Record<string, any>[] = []
let coarseObserver: ReturnType<typeof createCoarseRoutingDiagnostics> | undefined
const finishCoarseDiagnostics = (): void => {
  const report = coarseObserver?.finish()
  coarseObserver = undefined
  if (report) coarseReports.push(report)
  if (coarseReports.length) atomic("coarse-diagnostics.json", JSON.stringify({ reports: coarseReports }, null, 2))
}
for (const eventName of ["autorouting:start", "autorouting:end", "autorouting:error"] as const) {
  circuit.on(eventName, (event: any): void => {
    if (event.cacheStatus && event.cacheStatus !== "disabled") throw new Error(`Unexpected routing cache status ${event.cacheStatus}`)
    const name = event.phaseName ?? event.componentDisplayName ?? "unnamed"
    if (eventName === "autorouting:start") {
      if (progress.phases.length === 0) {
        const json = circuit.getCircuitJson()
        atomic("unrouted.circuit.json.gz", gzipSync(JSON.stringify(json), { level: 1 }))
        progress.initialCopperCounts = Object.fromEntries(["pcb_trace", "pcb_via", "pcb_copper_pour"].map(type => [type, json.filter(item => item.type === type).length]))
      }
      const inputBytes = JSON.stringify(event.simpleRouteJson)
      const index = progress.phases.length + 1
      atomic(`phase-${index}-input.srj.json.gz`, gzipSync(inputBytes, { level: 1 }))
      progress.phases.push({ name, index, solver: event.solverName, status: "running", startedMs: performance.now() - started, inputSha256: sha(inputBytes), connections: event.simpleRouteJson.connections.length, terminals: event.simpleRouteJson.connections.reduce((sum: number, connection: any) => sum + connection.pointsToConnect.length, 0), cacheStatus: event.cacheStatus, cacheDisabledReason: event.cacheDisabledReason })
    } else {
      const phase = running()
      if (phase) { phase.status = eventName === "autorouting:end" ? "completed" : "failed"; phase.elapsedMs = performance.now() - started - phase.startedMs }
      if (event.simpleRouteJson) atomic(`phase-${phase?.index ?? progress.phases.length}-${eventName === "autorouting:end" ? "output" : "error"}.srj.json.gz`, gzipSync(JSON.stringify(event.simpleRouteJson), { level: 1 }))
      if (eventName === "autorouting:error") progress.errors.push(event.error?.message ?? String(event.error))
    }
    save(true)
    console.log(JSON.stringify({ event: eventName, name, elapsedMs: progress.elapsedMs }))
  })
}
circuit.on("autorouting:progress", (event: any): void => {
  const phase = running()
  if (phase) { phase.progress = event.progress; phase.iterationsPerSecond = event.iterationsPerSecond }
})
circuit.on("solver:started", (event: any): void => {
  if (/wasm|krt/i.test(event.solverName) || (/AutoroutingPipeline|AssignableAutorouting/.test(event.solverName) && event.solverName !== "AutoroutingPipelineSolver9_PreloadedTraceGraph")) {
    progress.forbiddenRoutingSolverSelections.push(event.solverName)
    throw new Error(`Forbidden or unexpected routing strategy ${event.solverName}`)
  }
  const options = event.solverParams?.options
  if (options?.cacheProvider) throw new Error("Unexpected solver cache provider")
  const phaseName = running()?.name
  if (event.solverName === "AutoroutingPipelineSolver9_PreloadedTraceGraph" && targetPhase && (targetPhase === "*" || phaseName === targetPhase)) {
    finishCoarseDiagnostics()
    coarseObserver = createCoarseRoutingDiagnostics({
      pipelineClass: PublishedPipeline9, registeredPipelineClass: SOLVERS.AutoroutingPipelineSolver9_PreloadedTraceGraph,
      targetPhase: phaseName,
      onSnapshot: report => atomic("coarse-diagnostics.json", JSON.stringify({ reports: [...coarseReports, report] }, null, 2)),
    })
    coarseObserver.onSolverStarted(event, phaseName)
  }
  progress.solvers.push({ name: event.solverName, component: event.componentName, status: "running", startedMs: performance.now() - started, cacheProvider: options?.cacheProvider ? "present" : null })
})
circuit.on("solver:ended", (event: any): void => {
  const solver = progress.solvers.findLast((row: any) => row.name === event.solverName && row.status === "running")
  if (solver) Object.assign(solver, { status: event.solved && !event.failed ? "completed" : "failed", iterations: event.iterations, error: event.error, elapsedMs: performance.now() - started - solver.startedMs })
})
circuit.on("asyncEffect:end", (event: any): void => { if (event.error) progress.errors.push(String(event.error)) })
const heartbeat = setInterval(() => save(), 2000)
const captureDeadline = setTimeout((): void => {
  progress.status = "capture_deadline"
  progress.errors.push("900 second external capture deadline; solver budgets unchanged")
  finishCoarseDiagnostics()
  save(true)
  process.exit(124)
}, 900000)
try {
  circuit.add(<SourceBoard />)
  await circuit.renderUntilSettled()
  progress.renderCompleted = true
  for (const element of circuit.getCircuitJson()) if (element.type === "pcb_autorouting_error") progress.errors.push(element.message)
  progress.status = progress.errors.length || progress.phases.some((phase: any) => phase.status !== "completed") ? "failed" : executionMode === "geometry" ? "geometry_only" : "render_settled"
} catch (error) {
  progress.status = "failed"
  progress.errors.push(String(error))
  process.exitCode = 1
} finally {
  clearInterval(heartbeat)
  clearTimeout(captureDeadline)
  finishCoarseDiagnostics()
  save(true)
  try {
    atomic("pcb.svg.gz", gzipSync(convertCircuitJsonToPcbSvg(circuit.getCircuitJson(), { width: 1600, height: 1100, backgroundColor: "white", shouldDrawRatsNest: false, shouldDrawErrors: false, showPcbGroups: false }), { level: 1 }))
  } catch (error) { progress.visualizationError = String(error); save() }
  if (sha(readFileSync(task.sourcePath)) !== task.sourceSha256) throw new Error("Authoritative source was changed during render")
  for (const file of task.implementationFiles) if (sha(readFileSync(file.path)) !== file.sha256) throw new Error(`Circuit implementation changed during render: ${file.path}`)
  console.log(JSON.stringify({ event: "render-result", status: progress.status, elapsedMs: progress.elapsedMs, phases: progress.phases.length, partialCounts: progress.partialCounts, wasmUsage }))
}
