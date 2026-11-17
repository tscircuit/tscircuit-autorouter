import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"
import { pathToFileURL } from "node:url"
import { validateH616RegionalCut } from "./validate-h616-regional-cut"

type Data = Record<string, any>
const [rootArg, mode, workerMode] = process.argv.slice(2)
assert(rootArg && ["control", "candidate"].includes(mode!), "Usage: run-h616-regional-cut.ts ROOT control|candidate")
const root = resolve(rootArg!)
const plan = JSON.parse(readFileSync(join(import.meta.dir, "h616-regional-cut-plan.json"), "utf8"))
const output = join(root, "h616-regional-cut-results", mode!)
mkdirSync(output, { recursive: true })
const hash = (value: Buffer | string): string => createHash("sha256").update(typeof value === "string" ? value : new Uint8Array(value)).digest("hex")
let emittedBytes = 0
const write = (name: string, value: unknown): void => {
  const data = JSON.stringify(value)
  const bytes = Buffer.byteLength(data) + 1
  // Keep room for a compact fatal report without raising the capture cap.
  assert(emittedBytes + bytes + 8192 <= plan.maxDiagnosticBytes, "Diagnostic cap exceeded")
  writeFileSync(join(output, name), data + "\n")
  emittedBytes += bytes
}
let diagnosticPhase = "bootstrap"
let lastNativeState: Data | null = null
process.on("uncaughtException", (error: any): void => {
  const failure = { diagnosticPhase, name: error.name, code: error.code, message: String(error.message).slice(0, 2048),
    lastNativeState, stack: String(error.stack).split("\n").slice(0, 4).join("\n").slice(0, 2048) }
  const data = JSON.stringify(failure)
  if (emittedBytes + Buffer.byteLength(data) <= plan.maxDiagnosticBytes) writeFileSync(join(output, "failure.json"), data + "\n")
  console.error(JSON.stringify(failure))
  process.exit(1)
})
if (workerMode !== "worker") {
  const log = openSync(join(output, "worker.log"), "w")
  const worker = Bun.spawn([process.execPath, import.meta.path, root, mode!, "worker"], { stdout: log, stderr: log })
  let hardTimedOut = false
  const timer = setTimeout((): void => { hardTimedOut = true; worker.kill("SIGKILL") }, plan.hardDeadlineMs)
  const exitCode = await worker.exited
  clearTimeout(timer)
  closeSync(log)
  write("process.json", { exitCode, hardTimedOut, captureDeadlineMs: plan.captureDeadlineMs, hardDeadlineMs: plan.hardDeadlineMs })
  console.log(readFileSync(join(output, "worker.log"), "utf8"))
  assert.equal(exitCode, 0)
  assert.equal(hardTimedOut, false)
  process.exit(0)
}
assert.equal(Bun.version, "1.4.3")
assert(["arm64", "aarch64"].includes(process.arch), "Native screen requires ARM")
const started = performance.now()
const wasmUsage = { coldImportCalls: 0, coldImportStacks: [] as string[], routingOrUnknownAttempts: 0 }
let coldPublishedImport = false
const wrappers = new Map<PropertyKey, unknown>()
const guarded = new Set(["Module", "Instance", "Memory", "compile", "instantiate", "compileStreaming", "instantiateStreaming"])
globalThis.WebAssembly = new Proxy(globalThis.WebAssembly, {
  get(target, key, receiver): unknown {
    const value = Reflect.get(target, key, receiver)
    if (!guarded.has(String(key))) return value
    if (wrappers.has(key)) return wrappers.get(key)
    const check = (): void => {
      if (coldPublishedImport) {
        wasmUsage.coldImportCalls++
        if (wasmUsage.coldImportStacks.length < 6) wasmUsage.coldImportStacks.push(new Error().stack ?? "")
        return
      }
      wasmUsage.routingOrUnknownAttempts++
      throw new Error("Routing or unknown WebAssembly is forbidden")
    }
    const wrapped = new Proxy(value, {
      apply(fn, thisArg, args): unknown { check(); return Reflect.apply(fn, thisArg, args) },
      construct(fn, args): object { check(); return Reflect.construct(fn, args) },
    })
    wrappers.set(key, wrapped)
    return wrapped
  },
})
const readInput = (name: string): any => {
  const data = readFileSync(join(root, "h616-regional-cut-input", name))
  assert.equal(hash(data), plan.files[name])
  return JSON.parse(name.endsWith(".gz") ? gunzipSync(new Uint8Array(data)).toString() : data.toString())
}
const packet = readInput("failure-witness.json.gz")
assert.equal(packet.captureValid, true)
assert.deepEqual(packet.captureErrors, [])
for (const [digest, blob] of Object.entries(packet.blobs)) assert.equal(hash(JSON.stringify(blob)), digest)
const decode = (value: any): any => {
  if (value === null || typeof value !== "object") return value
  if (value.$blob) return decode(packet.blobs[value.$blob])
  if (value.$undefined) return undefined
  if (value.$number) return Number(value.$number)
  if (value.$map) return new Map(value.$map.map(([key, item]: any[]) => [decode(key), decode(item)]))
  if (value.$set) return new Set(value.$set.map(decode))
  assert(!value.$callback, "Cannot reconstruct an executable callback from data")
  if (Array.isArray(value)) return value.map(decode)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))
}
// Expected observations contain non-executable callback descriptors. Expand
// blob references for equality without trying to restore those callbacks.
const expandObservation = (value: any): any => {
  if (value === null || typeof value !== "object") return value
  if (value.$blob) return expandObservation(packet.blobs[value.$blob])
  if (Array.isArray(value)) return value.map(expandObservation)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandObservation(item)]))
}
const copyData = (value: any): any => {
  if (value === undefined) return { $undefined: true }
  if (typeof value === "function") return { $callback: value.name || "anonymous", executable: false }
  if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) }
  if (value === null || typeof value !== "object") return value
  if (value instanceof Map) return { $map: [...value].map(([key, item]) => [copyData(key), copyData(item)]) }
  if (value instanceof Set) return { $set: [...value].map(copyData) }
  if (Array.isArray(value)) return value.map(copyData)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyData(item)]))
}
const parameterData = (params: Data): Data => Object.fromEntries(Object.entries(params).map(([key, value]) => [key,
  key === "connMap" ? { className: value.constructor.name, netMap: copyData(value.netMap), idToNetMap: copyData(value.idToNetMap) } : copyData(value)]))
const compactTree = (rows: Data[]): Data => {
  const blobs: Data = {}
  const blob = (value: unknown): Data => {
    const data = JSON.stringify(value)
    const digest = hash(data)
    if (!Object.hasOwn(blobs, digest)) blobs[digest] = value
    return { $blob: digest }
  }
  const parameters = (values: Data): Data => Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
    key === "connMap" ? { className: value.className, netMap: blob(value.netMap), idToNetMap: blob(value.idToNetMap) }
      : value !== null && typeof value === "object" && !value.$undefined && !value.$callback && !value.$number ? blob(value) : value]))
  const tree = rows.map(row => ({ ...row,
    ...(row.parameters ? { parameters: parameters(row.parameters) } : {}),
    ...(row.nodeSolveMetadata ? { nodeSolveMetadata: blob(row.nodeSolveMetadata) } : {}),
  }))
  return { tree, blobs }
}
const context = decode(packet.pendingNodeAbsorptionContext)
const params = context.parentParameters
assert.equal(context.fixedRouteReplacements.size, 0)
assert.equal(context.removedFixedRouteConnectionNames.size, 0)
assert.equal(context.preloadedTraceMutationMasks.size, 0)
const originalRegional = packet.attempts.find((attempt: Data) => attempt.id === context.regionalAttemptId)
assert.equal(originalRegional.kind, "regional")
const helperProof = JSON.parse(readFileSync(join(root, "h616-source-helpers", "helper-proof.json"), "utf8"))
// Diagnostic helpers have their own byte-identical solver-utils registry.
// Every actual routing constructor is loaded from the verified published entry.
assert.equal(helperProof.qualified, true)
assert.equal(helperProof.sourceGraphIdentical, true)
assert.equal(helperProof.helperSourcesIdentical, true)
assert.equal(hash(readFileSync(helperProof.helperEntry)), helperProof.helperEntrySha256)
for (const entry of [helperProof.helperSolverUtilsEntry, helperProof.publishedSolverUtilsEntry]) assert.equal(hash(readFileSync(entry)), helperProof.solverUtilsEntrySha256)
const helperRuntime = await import(pathToFileURL(helperProof.helperSolverUtilsEntry).href)
const publishedRuntime = await import(pathToFileURL(helperProof.publishedSolverUtilsEntry).href)
assert.notEqual(helperRuntime.SolverRuntime, publishedRuntime.SolverRuntime)
const helpers = await import(pathToFileURL(helperProof.helperEntry).href)
assert.deepEqual(Object.keys(helpers).sort(), [...helperProof.exports].sort())
const manifest = JSON.parse(readFileSync(join(root, "runtime-manifest.json"), "utf8"))
const ar = manifest.packages.find((item: Data) => item.name === "@tscircuit/capacity-autorouter")
assert.equal(ar.version, "0.0.1117")
assert.equal(hash(readFileSync(ar.entry)), ar.entrySha256)
assert.equal(manifest.sourceOverrides, false)
coldPublishedImport = true
const published = await import(pathToFileURL(ar.entry).href)
coldPublishedImport = false
const nativeCache = published.getGlobalInMemoryCache()
assert(nativeCache instanceof published.InMemoryCache, "Expected the actual published global cache implementation")
const cacheCounters = (): Data => ({ hits: nativeCache.cacheHits, misses: nativeCache.cacheMisses, entries: nativeCache.cache.size, missesByPrefix: { ...nativeCache.cacheMissesByPrefix } })
const initialCacheCounters = cacheCounters()
const pipeline = new published.AutoroutingPipelineSolver9_PreloadedTraceGraph(readInput("phase-4-input.srj.json.gz"))
const connMap = pipeline.connMap
assert.deepEqual(Object.keys(connMap).sort(), ["idToNetMap", "netMap"])
assert.equal(connMap.constructor.name, params.connMap.className)
connMap.netMap = params.connMap.netMap
connMap.idToNetMap = params.connMap.idToNetMap
params.connMap = connMap
assert.deepEqual(parameterData(params), copyData(decode(packet.pendingNodeAbsorptionContext.parentParameters)))
const boardCircuitJson = readInput("circuit.json.gz")
const state = (solver: Data): Data => ({ className: solver.constructor.name, iterations: solver.iterations,
  MAX_ITERATIONS: solver.MAX_ITERATIONS, solved: solver.solved, failed: solver.failed, error: solver.error,
  growthAttempts: solver.growthAttempts ?? null, scaleFactor: solver.scaleFactor ?? null, maxGrowthAttempts: solver.maxGrowthAttempts ?? null,
  stats: solver.stats ? Object.fromEntries(Object.entries(solver.stats).filter(([, value]) => value === null || ["number", "string", "boolean"].includes(typeof value))) : null })
const tree = (solver: Data): Data[] => {
  const rows: Data[] = [], visited = new Map<Data, number>()
  const visit = (current: Data, parent: number | null, relation: string): void => {
    if (visited.has(current)) { rows.push({ parent, relation, solverRef: visited.get(current) }); return }
    assert(visited.size < 384)
    const id = visited.size
    visited.set(current, id)
    const row: Data = { id, parent, relation, ...state(current) }
    if (current.constructorParams) row.parameters = parameterData(current.constructorParams)
    if (current.nodeSolveMetadataById instanceof Map) row.nodeSolveMetadata = copyData(current.nodeSolveMetadataById)
    rows.push(row)
    if (Array.isArray(current.supervisedSolvers)) {
      assert(current.supervisedSolvers.length <= 8192)
      row.portfolioCandidates = current.supervisedSolvers.map((candidate: Data) => ({ ...state(candidate.solver), hyperParameters: copyData(candidate.hyperParameters), internalSearchTreeCaptured: false }))
      row.activeCandidateIndex = current.supervisedSolvers.findIndex((candidate: Data) => candidate.solver === current.activeSubSolver)
      return
    }
    for (const key of ["highDensitySolver", "activeSubSolver", "forceImproveSolver", "repairSolver", "winningSolver"]) if (current[key]) visit(current[key], id, key)
    for (const key of ["failedSolvers", "failedSubSolvers"]) if (Array.isArray(current[key])) for (const child of current[key]) visit(child, id, key)
  }
  visit(solver, null, "root")
  return rows
}
const build = (node: Data): Data => {
  const hd = new published.Pipeline9HighDensitySolver(params)
  hd.activeNode = node
  hd.startRegionalFallback()
  return hd
}
const stepUntilDone = (solver: Data): void => {
  while (!solver.solved && !solver.failed) {
    assert(performance.now() - started < plan.captureDeadlineMs, "Capture deadline exceeded")
    solver.step()
  }
  assert.equal(wasmUsage.routingOrUnknownAttempts, 0)
}
diagnosticPhase = "original constructor parity"
const control = build(context.activeNode)
assert.deepEqual(parameterData(control.activeFallbackSolver.params), copyData(decode(originalRegional.parameters)))
assert.deepEqual(copyData(control.activeFallbackFixedRouteSections), copyData(decode(originalRegional.fixedRouteSections)))
assert.deepEqual(copyData(control.activeFallbackFixedObstacleRoutes), copyData(decode(originalRegional.fixedObstacleRoutes)))
if (mode === "control") {
  diagnosticPhase = "original regional control"
  stepUntilDone(control.activeFallbackSolver)
  const actualState = state(control.activeFallbackSolver), actualTree = tree(control.activeFallbackSolver)
  lastNativeState = actualState
  write("control-state.json", actualState)
  diagnosticPhase = "original state parity"
  assert.deepEqual(actualState, originalRegional.final)
  diagnosticPhase = "original control evidence serialization"
  write("native-state.json", { state: actualState, ...compactTree(actualTree) })
  diagnosticPhase = "original complete coordinator and portfolio behavior parity"
  const expectedTree = expandObservation(originalRegional.candidates)
  const hdIndex = actualTree.findIndex(row => row.parent === 0 && row.relation === "highDensitySolver")
  assert(hdIndex >= 0)
  assert.equal(actualTree[hdIndex].className, control.activeFallbackSolver.highDensitySolver.constructor.name)
  assert.equal(expectedTree[hdIndex].relation, "highDensitySolver")
  assert.equal(expectedTree[hdIndex].className, actualTree[hdIndex].className)
  const actualCacheStats = actualTree[hdIndex].stats
  const expectedCacheStats = expectedTree[hdIndex].stats
  const finalCacheCounters = cacheCounters()
  assert.equal(initialCacheCounters.hits, 0)
  assert.equal(finalCacheCounters.hits, 0)
  assert.equal(actualCacheStats.intraNodeCacheHits, 0)
  assert.equal(expectedCacheStats.intraNodeCacheHits, 0)
  assert.equal(actualCacheStats.intraNodeCacheMisses, finalCacheCounters.misses)
  const rawDifferences: Data[] = []
  let rawDifferenceCount = 0
  const compare = (actual: any, expected: any, path: string): void => {
    if (Object.is(actual, expected)) return
    if (actual !== null && expected !== null && typeof actual === "object" && typeof expected === "object" && Array.isArray(actual) === Array.isArray(expected)) {
      for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
        if (Object.hasOwn(actual, key) !== Object.hasOwn(expected, key)) {
          rawDifferenceCount++
          if (rawDifferences.length < 64) rawDifferences.push({ path: `${path}.${key}`, difference: "key presence" })
        } else compare(actual[key], expected[key], `${path}.${key}`)
      }
      return
    }
    rawDifferenceCount++
    if (rawDifferences.length < 64) rawDifferences.push({ path, actual: typeof actual === "object" ? { sha256: hash(JSON.stringify(actual)) } : actual, expected: typeof expected === "object" ? { sha256: hash(JSON.stringify(expected)) } : expected })
  }
  compare(actualTree, expectedTree, "tree")
  const telemetryException = {
    path: `tree.${hdIndex}.stats.intraNodeCacheMisses`, baselineCumulativeMisses: expectedCacheStats.intraNodeCacheMisses,
    replayCumulativeMisses: actualCacheStats.intraNodeCacheMisses,
    inferredPriorProcessOffset: expectedCacheStats.intraNodeCacheMisses - actualCacheStats.intraNodeCacheMisses,
    baselineStartingTotalCaptured: false, replayInitialCounters: initialCacheCounters, replayFinalCounters: finalCacheCounters,
    replayMissDelta: finalCacheCounters.misses - initialCacheCounters.misses, cacheHitDelta: 0,
    source: ["HighDensitySolver.updateCacheStats copies the global aggregate", "InMemoryCache.getCachedSolutionSync increments misses only for undefined lookups", "InMemoryCache.clearCache resets counters and stored entries", "setupGlobalCaches stores a globalThis singleton"],
    notice: "Only cumulative miss telemetry is excluded. No baseline starting counter or baseline miss delta was captured. No cached result was reused in the control.",
  }
  write("control-tree-comparison.json", { rawDifferenceCount, rawDifferences, telemetryException })
  assert(rawDifferenceCount === 0 || (rawDifferenceCount === 1 && rawDifferences[0].path === telemetryException.path), "Unexpected native behavior difference")
  const comparableActual = structuredClone(actualTree), comparableExpected = structuredClone(expectedTree)
  delete comparableActual[hdIndex].stats.intraNodeCacheMisses
  delete comparableExpected[hdIndex].stats.intraNodeCacheMisses
  assert.deepEqual(comparableActual, comparableExpected)
  write("result.json", { valid: true, controlBehaviorParity: true, rawWholeTreeIdentical: rawDifferenceCount === 0,
    regionalStateExact: true, allOtherTreeFieldsExact: true, telemetryException, originalIterations: actualState.iterations,
    wasmUsage, helperProof, wallMs: performance.now() - started })
  console.log(JSON.stringify({ mode, valid: true, iterations: actualState.iterations, error: actualState.error }))
  process.exit(0)
}
diagnosticPhase = "candidate ownership preflight"
const controlResult = JSON.parse(readFileSync(join(root, "h616-regional-cut-results/control/result.json"), "utf8"))
assert.equal(controlResult.controlBehaviorParity, true)
assert.equal(controlResult.regionalStateExact, true)
assert.equal(controlResult.allOtherTreeFieldsExact, true)
assert.equal(controlResult.telemetryException.cacheHitDelta, 0)
const beforeParamsHash = hash(JSON.stringify(copyData(params)))
const beforeAcceptedHash = hash(JSON.stringify(copyData(context.priorSamePhaseRoutes)))
const selected = plan.absorbedNodeIds.map((id: string) => {
  const node = params.nodePortPoints.find((item: Data) => item.capacityMeshNodeId === id)
  assert(node && node.portPointsInPairs.length === 1 && node.portPoints.length === 2)
  assert(node.portPoints.every((port: Data) => connMap.areIdsConnected(port.connectionName, "source_net_116")))
  return node
})
assert(plan.absorbedNodeIds.slice(1).every((id: string) => context.pendingNodeIds.includes(id)))
const ports = selected.flatMap((node: Data) => node.portPoints)
const byPort = new Map<string, Data[]>()
for (const port of ports) byPort.set(port.portPointId, [...(byPort.get(port.portPointId) ?? []), port])
const originalRetained = plan.retainedPortIds.map((id: string) => {
  const copies = byPort.get(id)
  assert.equal(copies?.length, 1)
  return copies![0]!
})
for (const [id, copies] of byPort) if (!plan.retainedPortIds.includes(id)) {
  assert.equal(copies.length, 2)
  assert.deepEqual(copies.map(port => [port.x, port.y, port.z, port.connectionName, port.rootConnectionName]), [copies[0], copies[0]].map(port => [port.x, port.y, port.z, port.connectionName, port.rootConnectionName]))
  assert(copies.every(port => !port.pcbPortId && !port.pcb_port_id))
  assert.equal(params.nodePortPoints.flatMap((node: Data) => node.portPoints).filter((port: Data) => port.portPointId === id).length, 2)
}
const retained = [
  { ...originalRetained[0], nextPortPointId: originalRetained[1].portPointId },
  { ...originalRetained[1], prevPortPointId: originalRetained[0].portPointId },
]
const margin = params.viaDiameter / 2 + params.obstacleMargin
const bounds = { minX: Math.min(...ports.map((p: Data) => p.x)) - margin, maxX: Math.max(...ports.map((p: Data) => p.x)) + margin,
  minY: Math.min(...ports.map((p: Data) => p.y)) - margin, maxY: Math.max(...ports.map((p: Data) => p.y)) + margin }
const mergedNode = { ...context.activeNode, center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
  width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY, portPoints: retained, portPointsInPairs: [retained] }
const candidateParent = build(mergedNode)
const sections: Map<string, Data> = candidateParent.activeFallbackFixedRouteSections
assert.deepEqual([...sections.keys()].sort(), [...plan.mutablePreloadNames].sort())
for (const section of sections.values()) {
  assert.equal(section.sourceRoutes.length, 1)
  const source = section.sourceRoutes[0]
  assert(!source.isFixed && !source.isThroughObstacle)
  assert.equal(source.vias.length, 0)
}
const ownershipProof: Data[] = []
for (const [name, section] of sections) {
  const owner = section.sourceRoutes[0]
  const sameNet = (route: Data): boolean => helpers.arePipeline9RoutesOnSameNet(owner, route, connMap)
  assert.equal(context.priorSamePhaseRoutes.filter(sameNet).length, 0)
  assert.equal(params.nodePortPoints.flatMap((node: Data) => node.portPoints).filter(sameNet).length, 0)
  const chain = params.fixedHdRoutes.filter(sameNet).sort((a: Data, b: Data) => a.preloadedRouteIndex - b.preloadedRouteIndex)
  assert.equal(new Set(chain.map((route: Data) => route.preloadedTraceIndex)).size, 1)
  for (let index = 1; index < chain.length; index++) {
    const start = chain[index].route[0], end = chain[index - 1].route.at(-1)
    assert.deepEqual([start.x, start.y, start.z], [end.x, end.y, end.z])
  }
  const canonicalNet = [owner.rootConnectionName, owner.connectionName].map(name => connMap.getNetConnectedToId(name) ?? (Object.hasOwn(connMap.netMap, name) ? name : undefined)).find(Boolean)
  assert(canonicalNet, "Mutable source owner lacks native canonical net")
  const terminals = boardCircuitJson.filter((item: Data) => item.type === "pcb_port" && connMap.getNetConnectedToId(item.pcb_port_id) === canonicalNet)
  assert.equal(terminals.length, 2)
  const ends = [chain[0].route[0], chain.at(-1).route.at(-1)]
  const layers = ["top", "inner1", "inner2", "bottom"]
  for (const terminal of terminals) assert(ends.some(point => Math.abs(point.x - terminal.x) < 1e-9 && Math.abs(point.y - terminal.y) < 1e-9 && terminal.layers.includes(layers[point.z])))
  const inside = { ...owner, route: [section.start.point, ...owner.route.slice(section.start.segmentIndex + 1, section.end.segmentIndex + 1), section.end.point], vias: [] }
  const contacts = chain.filter((route: Data) => route.connectionName !== name && helpers.doPipeline9RoutesHaveCopperConflict({ left: inside, right: route, clearance: 1e-9, layerCount: params.layerCount, allowBlindAndBuriedVias: false }))
  for (const contact of contacts) assert(Math.abs(contact.preloadedRouteIndex - owner.preloadedRouteIndex) === 1, "Unowned same-net branch touches a mutable span")
  ownershipProof.push({ name, canonicalNet, chainFragments: chain.length, terminals: terminals.map((port: Data) => port.pcb_port_id), adjacentSourceContacts: contacts.map((route: Data) => route.connectionName), sameNetAcceptedRoutes: 0, sameNetAssignedPorts: 0 })
}
// The native builder only returns intersecting immutable source owners.
// Preserve every other original preload, including just-outside clearance
// context, and retain the exact outside pieces of each mutable real owner.
const deduplicatePoints = (points: Data[]): Data[] => points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y || point.z !== points[index - 1]!.z)
const outsideByName = new Map<string, Data[]>()
for (const [name, section] of sections) {
  const source = section.sourceRoutes[0]
  const pieces = [
    deduplicatePoints([...source.route.slice(0, section.start.segmentIndex + 1), section.start.point]),
    deduplicatePoints([section.end.point, ...source.route.slice(section.end.segmentIndex + 1)]),
  ].filter(points => points.length >= 2)
  outsideByName.set(name, pieces.map(route => ({ ...source, route, vias: [] })))
}
const immutablePreloadRoutes = params.fixedHdRoutes.flatMap((route: Data) => outsideByName.get(route.connectionName) ?? [route])
const acceptedRoutes = context.priorSamePhaseRoutes
const fixedObstacles = helpers.getPipeline9FixedRouteObstacles({ fixedObstacleRoutes: [...immutablePreloadRoutes, ...acceptedRoutes], layerCount: params.layerCount, allowBlindAndBuriedVias: params.allowBlindAndBuriedVias })
const NativeRegional = control.activeFallbackSolver.constructor
const candidate = new NativeRegional({ ...candidateParent.activeFallbackSolver.params,
  obstacles: [...params.obstacles, ...fixedObstacles] })
const rejectionExamples: Data[] = []
let rejectionExampleBytes = 0
const rejectionCategories = new Set<string>()
const validationCounts: Data = { calls: 0, nativeRejected: 0, guardRejected: 0, reasons: {} }
const validationInput = { helpers, mergedNode: candidate.params.nodeWithPortPoints, parentParams: params, connMap, absorbedNodeIds: plan.absorbedNodeIds,
  originalNodes: params.nodePortPoints, pendingNodeIds: context.pendingNodeIds, acceptedRoutes, immutablePreloadRoutes, boardCircuitJson }
const nativeValidate = candidate.validateCandidateRoutes.bind(candidate)
const guard = (routes: Data[]): any => validateH616RegionalCut({ ...validationInput, candidateRoutes: routes })
candidate.validateCandidateRoutes = (routes: Data[]): boolean => {
  validationCounts.calls++
  if (!nativeValidate(routes)) { validationCounts.nativeRejected++; return false }
  const result = guard(routes)
  if (!result.valid) {
    validationCounts.guardRejected++
    const categories = Object.keys(result.failureCounts).sort().join(",")
    if (rejectionExamples.length < 3 && !rejectionCategories.has(categories)) {
      const example = { validationCall: validationCounts.calls, failureCounts: result.failureCounts, firstFailures: result.firstFailures, actualRoutes: copyData(routes) }
      const bytes = Buffer.byteLength(JSON.stringify(example))
      if (rejectionExampleBytes + bytes <= 256 * 1024) {
        rejectionExamples.push(example)
        rejectionCategories.add(categories)
        rejectionExampleBytes += bytes
      }
    }
    for (const [kind, count] of Object.entries(result.failureCounts)) validationCounts.reasons[kind] = (validationCounts.reasons[kind] ?? 0) + Number(count)
  }
  return result.valid
}
write("case.json", { ownershipProof, bounds, margin, retainedPorts: copyData(retained), originalRetainedPorts: copyData(originalRetained), sections: copyData(sections), immutableFragmentCount: immutablePreloadRoutes.length,
  acceptedRouteCount: acceptedRoutes.length, parameters: parameterData(candidate.params) })
diagnosticPhase = "candidate regional screen"
stepUntilDone(candidate)
lastNativeState = state(candidate)
diagnosticPhase = "candidate output and splice validation"
const result: Data = { valid: true, regionalSolved: candidate.solved, regionalFailed: candidate.failed, state: state(candidate), validationCounts,
  fullBoardGainMeasured: false, wasmUsage, controlBehaviorParity: true, controlTelemetryException: controlResult.telemetryException, wallMs: performance.now() - started }
if (candidate.solved) {
  const routes = candidate.getOutput()
  assert.equal(guard(routes).valid, true)
  const replacements = [], newRoutes = routes.filter((route: Data) => !sections.has(route.connectionName))
  assert.equal(newRoutes.length, 1)
  for (const [name, section] of sections) {
    const matches = routes.filter((route: Data) => route.connectionName === name)
    assert.equal(matches.length, 1, "A mutable source section was omitted or split")
    const spliced = helpers.spliceFixedRouteSectionWithMutationMask({ section, replacement: matches[0], sourceMutationMasks: new Map(), replacementIsMutated: true })
    const source = section.sourceRoutes[0]
    assert.deepEqual(spliced.route.route[0], source.route[0])
    assert.deepEqual(spliced.route.route.at(-1), source.route.at(-1))
    assert.equal(spliced.route.preloadedTraceIndex, source.preloadedTraceIndex)
    assert.equal(spliced.route.preloadedRouteIndex, source.preloadedRouteIndex)
    const outside = spliced.mutatedSegments.flatMap((mutated: boolean, index: number) => mutated ? [] : [[spliced.route.route[index], spliced.route.route[index + 1]]])
    const expectedOutside = outsideByName.get(name)!.flatMap(piece => piece.route.slice(1).map((point: Data, index: number) => [piece.route[index], point]))
    assert.deepEqual(outside, expectedOutside, "Outside source copper changed during final splice")
    assert.equal(spliced.route.traceThickness, source.traceThickness)
    assert.equal(spliced.route.viaDiameter, source.viaDiameter)
    replacements.push({ name, ...spliced, outside })
  }
  // Re-extract actual mutated segments from the final spliced routes, so the
  // final guard observes splice output rather than the pre-splice candidate.
  const finalLocal = replacements.map(replacement => {
    const indices = replacement.mutatedSegments.flatMap((mutated: boolean, index: number) => mutated ? [index] : [])
    assert(indices.length > 0)
    assert.equal(indices.at(-1)! - indices[0]! + 1, indices.length)
    const route = replacement.route.route.slice(indices[0], indices.at(-1)! + 2)
    return { ...replacement.route, route, vias: helpers.getPipeline9RouteCopperGeometry({ ...replacement.route, route, vias: [] }, params).viaSpans.map((via: Data) => ({ ...via.center, zStart: via.minZ, zEnd: via.maxZ })) }
  })
  assert.equal(guard([...newRoutes, ...finalLocal]).valid, true)
  const serialized = JSON.stringify({ newRoutes, replacements, retainedPorts: retained })
  emittedBytes += Buffer.byteLength(serialized)
  assert(emittedBytes <= plan.maxDiagnosticBytes)
  writeFileSync(join(output, "candidate-copper.json.gz"), new Uint8Array(gzipSync(serialized)))
  result.newRouteCount = newRoutes.length
  result.replacementCount = replacements.length
}
assert.equal(hash(JSON.stringify(copyData(context.priorSamePhaseRoutes))), beforeAcceptedHash, "Accepted same-phase copper changed")
assert.equal(hash(JSON.stringify(copyData(params))), beforeParamsHash, "Original parent input or immutable geometry changed")
write("native-state.json", { state: state(candidate), ...compactTree(tree(candidate)) })
write("guard-rejection-examples.json", { examples: rejectionExamples, bytes: rejectionExampleBytes, capBytes: 256 * 1024 })
write("result.json", result)
console.log(JSON.stringify(result))
