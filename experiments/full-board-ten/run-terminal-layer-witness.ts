import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { gzipSync, gunzipSync } from "node:zlib"
import { createTerminalLayerObserver } from "./createTerminalLayerObserver"
import { createCoarseRoutingDiagnostics } from "./createCoarseRoutingDiagnostics"

const [runtimePath, output] = process.argv.slice(2)
assert(runtimePath && output, "Usage: run-terminal-layer-witness.ts RUNTIME.json OUTPUT")
mkdirSync(output, { recursive: true })
const runtime = JSON.parse(readFileSync(runtimePath, "utf8"))
const sha = (contents: string | Uint8Array): string => createHash("sha256").update(contents).digest("hex")
assert.equal(sha(readFileSync(runtime.autorouterEntry)), runtime.autorouterSha256)
const inputBytes = gunzipSync(readFileSync(runtime.inputPath))
assert.equal(sha(inputBytes), runtime.inputSha256)
const input = JSON.parse(inputBytes.toString())
const atomicJson = (name: string, value: unknown): void => {
  const target = join(output, name)
  writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2))
  renameSync(`${target}.tmp`, target)
}

// The same WASM policy as the native full-board harness: no routing WASM.
const wasmUsage = { coldImportCalls: 0, geometryCalls: 0, routingOrUnknownAttempts: 0 }
let importingPublishedAutorouter = true
const copperModule = fileURLToPath(import.meta.resolve("@tscircuit/copper-pour-solver"))
const geometryModuleOrigins = [...new Set([import.meta.dir, dirname(copperModule)].flatMap(context => ["@tscircuit/manifold-2d", "@tscircuit/manifold-2d/manifold"].flatMap(name => {
  const path = Bun.resolveSync(name, context)
  return [path, realpathSync(path)]
})))]
const nativeWasm = globalThis.WebAssembly
const guarded = new Set(["Module", "Instance", "Memory", "compile", "instantiate", "compileStreaming", "instantiateStreaming"])
const wrappers = new Map<PropertyKey, unknown>()
globalThis.WebAssembly = new Proxy(nativeWasm, {
  get(target, key, receiver): unknown {
    const original = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return original
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => {
      if (importingPublishedAutorouter) { wasmUsage.coldImportCalls++; return }
      const stack = new Error().stack ?? ""
      if (!geometryModuleOrigins.some(origin => stack.includes(origin)) || /krt-wasm|krt_wasm/i.test(stack)) {
        wasmUsage.routingOrUnknownAttempts++
        throw new Error("Routing or unknown WebAssembly is disabled for the native phase replay")
      }
      wasmUsage.geometryCalls++
    }
    const wrapped = new Proxy(original, {
      apply(fn, thisArg, args): unknown { check(); return Reflect.apply(fn, thisArg, args) },
      construct(fn, args): object { check(); return Reflect.construct(fn, args) },
    })
    wrappers.set(key, wrapped)
    return wrapped
  },
})

const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(pathToFileURL(runtime.autorouterEntry).href)
importingPublishedAutorouter = false
const constructorOptions = {
  capacityDepth: undefined,
  targetMinCapacity: undefined,
  cacheProvider: null,
  effort: undefined,
}
const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, constructorOptions)
assert.equal(typeof pipeline.stepAsync, "undefined", "Core stepping contract changed")
const observer = createTerminalLayerObserver(pipeline)
// Wrap the existing observed factory once; retain its original parameter identity.
const stitchDefinition = pipeline.pipelineDef.find((entry: Record<string, any>) => entry.solverName === "highDensityStitchSolver")
assert(stitchDefinition)
const observedStitchFactory = stitchDefinition.getConstructorParams
let completeStitchInput: Record<string, any> | null = null
let stitchFactoryCalls = 0
const captureErrors: string[] = []
stitchDefinition.getConstructorParams = function (this: unknown, ...args: unknown[]): unknown {
  const parameters = Reflect.apply(observedStitchFactory, this, args)
  assert.equal(++stitchFactoryCalls, 1, "Native stitch constructor repeated")
  const raw = JSON.stringify(parameters[0])
  if (Buffer.byteLength(raw) > runtime.allNetPacketLimitBytes) {
    captureErrors.push("Complete native stitch input exceeds declared bound; capture omitted and native routing continued")
  } else {
    completeStitchInput = JSON.parse(raw)
    writeFileSync(join(output, "all-net-stitch-input.json.gz"), gzipSync(raw, { level: 1 }))
  }
  return parameters
}
const completedSingles = new WeakSet<object>()
const allNetStitchResults: Record<string, any>[] = []
let nativeStitchQueue: Record<string, any>[] | null = null
const captureCompletedSingle = (single: Record<string, any> | null): void => {
  if (!single || (!single.solved && !single.failed) || completedSingles.has(single)) return
  completedSingles.add(single)
  const route = single.mergedHdRoute
  allNetStitchResults.push({
    connectionName: route?.connectionName ?? null, solved: single.solved, failed: single.failed,
    error: single.error, iterations: single.iterations,
    start: structuredClone(single.start), end: structuredClone(single.end),
    first: structuredClone(route?.route?.[0] ?? null), last: structuredClone(route?.route?.at(-1) ?? null),
    startPcbPortId: route?.startPcbPortId ?? null, endPcbPortId: route?.endPcbPortId ?? null,
    stitchClearanceMode: single.stitchClearanceMode,
  })
}
let coarseReport: Record<string, any> | null = null
const coarseObserver = createCoarseRoutingDiagnostics({
  pipelineClass: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  registeredPipelineClass: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  targetPhase: "plane_escape",
  onSnapshot(report): void { coarseReport = report },
})
coarseObserver.onSolverStarted({
  solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  solverParams: { input, options: constructorOptions },
}, "plane_escape")
const started = performance.now()
let lastFlush = started
let timedOut = false
let thrownError: string | null = null
const checkpoint = (): void => {
  const raw = JSON.stringify(observer.getReport())
  if (Buffer.byteLength(raw) > runtime.diagnosticPacketLimitBytes) {
    const message = "Target observation exceeds declared bound; capture omitted and native routing continued"
    if (!captureErrors.includes(message)) captureErrors.push(message)
  } else {
    const target = join(output, "terminal-observation.json.gz")
    writeFileSync(`${target}.tmp`, gzipSync(raw, { level: 1 }))
    renameSync(`${target}.tmp`, target)
  }
  if (coarseReport) atomicJson("coarse-diagnostics.json", { reports: [coarseReport] })
  atomicJson("progress.json", {
    diagnosticOnly: true, elapsedMs: performance.now() - started,
    solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error,
    phase: pipeline.getCurrentPhase(), iterations: pipeline.iterations, wasmUsage,
  })
}
try {
  while (!pipeline.solved && !pipeline.failed) {
    const batchStarted = performance.now()
    do {
      if (pipeline.highDensityStitchSolver && nativeStitchQueue === null) {
        nativeStitchQueue = pipeline.highDensityStitchSolver.unsolvedRoutes.map((item: Record<string, any>) => ({
          connectionName: item.connectionName, start: structuredClone(item.start), end: structuredClone(item.end),
        }))
      }
      const previousSingle = observer.beforePipelineStep()
      pipeline.step()
      observer.afterPipelineStep(previousSingle)
      captureCompletedSingle(previousSingle)
      if (performance.now() - started >= 900000) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) {
      checkpoint()
      lastFlush = performance.now()
      console.log(`TERMINAL_WITNESS_PROGRESS ${JSON.stringify({ phase: pipeline.getCurrentPhase(), iterations: pipeline.iterations, elapsedMs: lastFlush - started })}`)
    }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise(resolve => setTimeout(resolve, 0))
  }
} catch (error) {
  thrownError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error).slice(0, 8000)
} finally {
  coarseReport = coarseObserver.finish()
  observer.dispose()
  checkpoint()
}
assert.equal(sha(readFileSync(runtime.autorouterEntry)), runtime.autorouterSha256)
assert.equal(sha(gunzipSync(readFileSync(runtime.inputPath))), runtime.inputSha256)
const observation = observer.getReport()
const coarse = coarseReport?.final
const coarseBytes = JSON.stringify({ reports: [coarseReport] }, null, 2)
const exactCoarseSha256 = sha(coarseBytes)
const nativeCoarseReproduced = exactCoarseSha256 === runtime.expectedCoarseDiagnosticSha256 &&
  coarseReport?.configured?.routeCount === 559 && coarseReport?.configured?.portCount === 130265 &&
  coarseReport?.configured?.regionCount === 66397 && coarseReport?.configured?.MAX_ITERATIONS === 2000000 &&
  coarse?.solved === true && coarse.failed === false && coarse.pendingRouteCount === 0 &&
  coarse.stats.acceptedGreedyFinalRouteOnTimeout === true && coarse.stats.greedyFinalRouteIter === 4 &&
  coarse.stats.greedyFinalRouteRemainingRouteCount === 60
const stageNames = ["highDensityForceImproveSolver", "highDensityRepairSolver", "highDensityStitchSolver"]
const stageInputsCaptured = stageNames.every(name => Array.isArray(observation.stages[name]?.rootRoutes))
const targetRouteCountsByStage = Object.fromEntries(stageNames.map(name => [name, observation.stages[name]?.rootRoutes?.filter((route: Record<string, any>) => route.connectionName === "source_net_0_mst8").length ?? null]))
const allStageStates = pipeline.pipelineDef.map((definition: Record<string, any>) => {
  const stage = pipeline[definition.solverName]
  return { name: definition.solverName, constructed: Boolean(stage), solved: stage?.solved ?? null,
    failed: stage?.failed ?? null, error: stage?.error ?? null, iterations: stage?.iterations ?? null }
})
const stitchedRoutes = pipeline.highDensityStitchSolver?.mergedHdRoutes ?? null
if (stitchedRoutes) {
  const raw = JSON.stringify(stitchedRoutes)
  if (Buffer.byteLength(raw) > runtime.allNetPacketLimitBytes) {
    captureErrors.push("Complete stitched routes exceed declared bound; capture omitted and native output retained")
  } else {
    writeFileSync(join(output, "all-net-stitched-routes.json.gz"), gzipSync(raw, { level: 1 }))
  }
}
let phaseOutput: Record<string, any> | null = null
let outputError: string | null = null
if (pipeline.solved) {
  try {
    // One normal final-output request, after the unmodified native pipeline has solved.
    const srj = pipeline.getOutputSimpleRouteJson()
    const raw = JSON.stringify(srj)
    writeFileSync(join(output, "phase-output.srj.json.gz"), gzipSync(raw, { level: 1 }))
    phaseOutput = { sha256: sha(raw), connectionCount: srj.connections.length, traceCount: srj.traces.length,
      connectionNames: [...new Set(srj.traces.map((trace: Record<string, any>) => trace.connection_name))] }
  } catch (error) { outputError = String(error) }
}
globalThis.WebAssembly = nativeWasm
const uniqueNames = (items: Record<string, any>[], key: string): string[] => [...new Set<string>(items.map(item => item[key]).filter((name): name is string => typeof name === "string"))].sort()
const declaredConnectionNames = completeStitchInput ? uniqueNames(completeStitchInput.connections, "name") : []
const hdConnectionNames = completeStitchInput ? uniqueNames(completeStitchInput.hdRoutes, "connectionName") : []
const mergedConnectionNames = stitchedRoutes ? uniqueNames(stitchedRoutes, "connectionName") : []
const queuedConnectionNames = nativeStitchQueue ? uniqueNames(nativeStitchQueue, "connectionName") : []
const completedConnectionNames = uniqueNames(allNetStitchResults, "connectionName")
const inputNetNames = uniqueNames(input.connections, "name")
const outputNetNames: string[] = phaseOutput?.connectionNames ?? []
const missing = (expected: string[], observed: string[]): string[] => expected.filter(name => !observed.includes(name))
const allNetCoverage = {
  inputNetNames, outputNetNames, declaredConnectionNames, hdConnectionNames, mergedConnectionNames,
  queuedConnectionNames, completedConnectionNames,
  nativeQueueCount: nativeStitchQueue?.length ?? null, completedSingleCount: allNetStitchResults.length,
  declaredConnectionsWithoutFragments: missing(declaredConnectionNames, hdConnectionNames),
  declaredConnectionsWithoutMergedOutput: missing(declaredConnectionNames, mergedConnectionNames),
  hdConnectionsWithoutMergedOutput: missing(hdConnectionNames, mergedConnectionNames),
  queuedConnectionsWithoutObservedCompletion: missing(queuedConnectionNames, completedConnectionNames),
  inputNetsWithoutOutput: missing(inputNetNames, outputNetNames),
}
const allNetCoverageValid = declaredConnectionNames.length > 0 && hdConnectionNames.length > 0 &&
  nativeStitchQueue !== null && nativeStitchQueue.length > 0 &&
  nativeStitchQueue.length === allNetStitchResults.length &&
  allNetCoverage.declaredConnectionsWithoutFragments.length === 0 &&
  allNetCoverage.declaredConnectionsWithoutMergedOutput.length === 0 &&
  allNetCoverage.hdConnectionsWithoutMergedOutput.length === 0 &&
  allNetCoverage.queuedConnectionsWithoutObservedCompletion.length === 0 &&
  allNetCoverage.inputNetsWithoutOutput.length === 0
const nativePhaseQualified = pipeline.solved && !pipeline.failed && nativeCoarseReproduced && stageInputsCaptured &&
  completeStitchInput !== null && captureErrors.length === 0 && phaseOutput !== null && allNetCoverageValid && !outputError && !timedOut && !thrownError &&
  wasmUsage.routingOrUnknownAttempts === 0 && allNetStitchResults.every(attempt => !attempt.failed)
const result = {
  ...runtime, elapsedMs: performance.now() - started,
  solved: pipeline.solved, failed: pipeline.failed, error: pipeline.error,
  iterations: pipeline.iterations, timedOut, thrownError, wasmUsage,
  nativeCoarseReproduced, exactCoarseSha256, stageInputsCaptured, targetRouteCountsByStage,
  completeStitchInputCaptured: completeStitchInput !== null, stitchFactoryCalls, captureErrors,
  allStageStates, allNetStitchResults, stitchedRouteCount: stitchedRoutes?.length ?? null,
  nativeStitchQueue, allNetCoverage, allNetCoverageValid, phaseOutput, outputError, nativePhaseQualified,
  interpretation: "Native complete plane_escape qualification with all original net/clearance context and unchanged guards. This is not a physical full-board completion or global DRC result; that requires the separately gated native Core board run.",
}
atomicJson("result.json", result)
console.log(`TERMINAL_WITNESS_RESULT ${JSON.stringify(result)}`)
if (!nativePhaseQualified) process.exitCode = 1
