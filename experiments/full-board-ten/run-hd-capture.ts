import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { gunzipSync, gzipSync } from "node:zlib"

// Diagnostic only: observe the published solver's ordinary synchronous steps.
// No production methods, budgets, geometry, ordering, or results are replaced.
type RuntimeObject = Record<string, any>
type ObservedAttempt = {
  solver: RuntimeObject
  kind: "b01" | "regional"
  record: RuntimeObject
  retained: boolean
}

const flags = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((entries, value, index, args) => {
    if (index % 2 === 0) entries.push([value, args[index + 1]!])
    return entries
  }, []),
)
for (const flag of ["--module", "--input", "--output", "--root", "--manifest"]) {
  assert(flags[flag], `Missing ${flag}`)
}
const modulePath = resolve(flags["--module"]!)
const inputPath = resolve(flags["--input"]!)
const outputDirectory = resolve(flags["--output"]!)
const targetRoot = flags["--root"]!
const deadlineMs = Number(flags["--deadline-seconds"] ?? "900") * 1000
assert(Number.isFinite(deadlineMs) && deadlineMs > 0)
mkdirSync(outputDirectory, { recursive: true })

const sha = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex")
const entryBytes = readFileSync(modulePath)
const runtimeManifest = JSON.parse(readFileSync(resolve(flags["--manifest"]!), "utf8"))
const publishedAutorouter = runtimeManifest.packages.find((entry: RuntimeObject) => entry.name === "@tscircuit/capacity-autorouter")
assert.equal(runtimeManifest.mainVersion, "0.0.3234")
assert.equal(runtimeManifest.sourceOverrides, false)
assert.equal(runtimeManifest.dependencyOverrides.length, 0)
assert.equal(publishedAutorouter.version, "0.0.1127")
assert.equal(publishedAutorouter.entry, modulePath)
assert.equal(publishedAutorouter.entrySha256, sha(entryBytes))
assert.equal(Bun.version, "1.4.3")
assert.equal(process.arch, "arm64")
const compressedInput = readFileSync(inputPath)
const inputBytes = inputPath.endsWith(".gz")
  ? gunzipSync(compressedInput)
  : compressedInput
const input = JSON.parse(inputBytes.toString())
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

const blobs: Record<string, unknown> = {}
let serializedBytes = 0
let observationMs = 0
let observedAttempts = 0
const retainedAttempts: RuntimeObject[] = []
const attempts = new WeakMap<object, ObservedAttempt>()
const activeAttempts = new Set<ObservedAttempt>()
const phaseTransitions: RuntimeObject[] = []
const targetNodeIds = new Set<string>()
const uniformFamiliesBefore = new Map<string, RuntimeObject>()
let uniformCaptured = false
let failedB01Count = 0
let lastRegional: ObservedAttempt | undefined
let captureError: string | null = null
let executionError: string | null = null

function copyData(value: any, depth = 0): any {
  assert(depth < 80, "Diagnostic nesting limit exceeded")
  if (value === undefined) return { $undefined: true }
  if (typeof value === "function") return { $callback: value.name || "anonymous", executable: false }
  if (typeof value === "number" && !Number.isFinite(value)) return { $number: String(value) }
  if (value === null || typeof value !== "object") return value
  if (value instanceof Map) return { $map: [...value].map(([key, item]) => [copyData(key, depth + 1), copyData(item, depth + 1)]) }
  if (value instanceof Set) return { $set: [...value].map((item) => copyData(item, depth + 1)) }
  if (Array.isArray(value)) return value.map((item) => copyData(item, depth + 1))
  assert(Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, "Unexpected class in diagnostic data")
  return Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(value)).filter(([, descriptor]) => descriptor.enumerable).map(([key, descriptor]) => {
    assert("value" in descriptor, `Unexpected accessor ${key}`)
    return [key, copyData(descriptor.value, depth + 1)]
  }))
}

function copyParameters(params: RuntimeObject): RuntimeObject {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => {
    if (key !== "connMap" || value === null || value === undefined) return [key, copyData(value)]
    assert(value.netMap && value.idToNetMap, "Expected native connectivity maps")
    return [key, {
      $connectivityMap: true,
      netMap: copyData(value.netMap),
      idToNetMapSha256: sha(JSON.stringify(copyData(value.idToNetMap))),
    }]
  }))
}

function storeEncoded(value: unknown): RuntimeObject {
  const json = JSON.stringify(value)
  const digest = sha(json)
  if (!Object.hasOwn(blobs, digest)) {
    serializedBytes += Buffer.byteLength(json)
    assert(serializedBytes <= 24 * 1024 * 1024, "Unique diagnostic data exceeded 24 MiB")
    blobs[digest] = value
  }
  return { $blob: digest }
}

function storeRecordFields(record: RuntimeObject): RuntimeObject {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key,
    value !== null && typeof value === "object" ? storeEncoded(value) : value,
  ]))
}

function state(solver: RuntimeObject): RuntimeObject {
  return {
    className: solver.constructor.name,
    iterations: solver.iterations,
    MAX_ITERATIONS: solver.MAX_ITERATIONS,
    solved: solver.solved,
    failed: solver.failed,
    error: solver.error,
    stats: solver.stats ? Object.fromEntries(Object.entries(solver.stats).filter(([, value]) => value === null || ["number", "string", "boolean"].includes(typeof value))) : null,
  }
}

function failureTree(root: RuntimeObject): RuntimeObject[] {
  const rows: RuntimeObject[] = []
  const seen = new Set<object>()
  function visit(solver: RuntimeObject, parent: number | null, relation: string): void {
    if (!solver || seen.has(solver)) return
    assert(seen.size < 384, "Failure tree exceeded 384 instances")
    seen.add(solver)
    const index = rows.length
    const row: RuntimeObject = { index, parent, relation, ...state(solver) }
    rows.push(row)
    if (Array.isArray(solver.supervisedSolvers)) {
      row.portfolioCandidates = solver.supervisedSolvers.map((candidate: RuntimeObject) => ({ ...state(candidate.solver), hyperParameters: copyData(candidate.hyperParameters) }))
      return
    }
    for (const field of ["highDensitySolver", "activeSubSolver", "forceImproveSolver", "repairSolver", "winningSolver"]) visit(solver[field], index, field)
    for (const field of ["failedSolvers", "failedSubSolvers"]) {
      if (Array.isArray(solver[field])) for (const child of solver[field]) visit(child, index, field)
    }
  }
  visit(root, null, "root")
  return rows
}

function containsTarget(node: RuntimeObject, hd: RuntimeObject): boolean {
  const nativeNet = hd.connMap.getNetConnectedToId(targetRoot) ?? targetRoot
  return node.portPoints.some((point: RuntimeObject) => {
    const identity = point.rootConnectionName ?? point.connectionName
    return identity === targetRoot || (hd.connMap.getNetConnectedToId(identity) ?? identity) === nativeNet
  })
}

function captureParent(hd: RuntimeObject): RuntimeObject {
  return {
    state: state(hd),
    parameters: copyParameters(hd.params),
    activeNode: copyData(hd.activeNode),
    unsolvedNodePortPoints: copyData(hd.unsolvedNodePortPoints),
    acceptedRoutes: copyData(hd.routes),
    fixedRouteReplacements: copyData(hd.fixedRouteReplacements),
    removedFixedRouteConnectionNames: copyData(hd.removedFixedRouteConnectionNames),
    preloadedTraceMutationMasks: copyData(hd.preloadedTraceMutationMasks),
  }
}

function observeBefore(): void {
  const uniform = pipeline.uniformPortDistributionSolver
  if (uniform && !uniformCaptured) {
    assert.equal(uniform.solved, false, "Uniform input must be observed before completion")
    assert.equal(uniform.currentOwnerPairBeingProcessed, null, "Uniform input must precede redistribution")
    for (const [key, points] of uniform.mapOfOwnerPairToPortPoints) {
      uniformFamiliesBefore.set(key, {
        points: copyData(points),
        sharedEdge: copyData(uniform.mapOfOwnerPairToSharedEdge.get(key)),
      })
    }
    uniformCaptured = true
  }
  const hd = pipeline.highDensityRouteSolver
  if (!hd?.activeNode || !containsTarget(hd.activeNode, hd)) return
  targetNodeIds.add(hd.activeNode.capacityMeshNodeId)
  for (const [field, kind] of [["activeB01Solver", "b01"], ["activeFallbackSolver", "regional"]] as const) {
    const solver = hd[field]
    if (!solver || attempts.has(solver)) continue
    assert(observedAttempts < 48, "Target created more than 48 observed attempts")
    assert.equal(solver.iterations, 0, "Native constructor capture must precede its first solver step")
    const params = kind === "b01" ? solver.getConstructorParams()[0] : solver.params
    assert(params && typeof params === "object")
    const record: RuntimeObject = {
      id: observedAttempts++, kind, initial: state(solver),
      node: copyData(hd.activeNode),
      constructorParameters: copyParameters(params),
      MAX_RIPS: kind === "b01" ? solver.MAX_RIPS : null,
      parent: captureParent(hd),
      regionalReason: hd.activeFallbackReason,
    }
    const nodePortIds = new Set(hd.activeNode.portPoints.map((point: RuntimeObject) => point.portPointId))
    record.portPlacement = [...uniformFamiliesBefore].flatMap(([ownerPairKey, before]) => {
      if (!before.points.some((point: RuntimeObject) => nodePortIds.has(point.portPointId))) return []
      const familyIds = new Set(before.points.map((point: RuntimeObject) => point.portPointId))
      return [{
        ownerPairKey,
        before,
        after: copyData(uniform.mapOfOwnerPairToPortPoints.get(ownerPairKey)),
        finalNodes: copyData(uniform.redistributedNodes.flatMap((node: RuntimeObject) => {
          const portPoints = node.portPoints.filter((point: RuntimeObject) => familyIds.has(point.portPointId))
          return portPoints.length === 0 ? [] : [{ capacityMeshNodeId: node.capacityMeshNodeId, portPoints }]
        })),
        availableSegmentPorts: copyData(pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints.flatMap((segment: RuntimeObject) => {
          const portPoints = segment.portPoints.filter((point: RuntimeObject) => point.availableZ.some((z: number) => familyIds.has(`${point.segmentPortPointId}::${z}`)))
          return portPoints.length === 0 ? [] : [{ edgeId: segment.edgeId, nodeIds: segment.nodeIds, start: segment.start, end: segment.end, portPoints }]
        })),
      }]
    })
    assert(record.portPlacement.length > 0, "Target node has no retained original port family")
    if (kind === "b01") {
      record.nativeObstacleMapping = params.obstacles.flatMap((obstacle: RuntimeObject, convertedIndex: number) => {
        if (obstacle.type !== "rect") return []
        const matches = hd.obstacles.flatMap((native: RuntimeObject, nativeIndex: number) => {
          if (native.center.x !== obstacle.center.x || native.center.y !== obstacle.center.y || native.width !== obstacle.width || native.height !== obstacle.height || (native.ccwRotationDegrees ?? 0) !== (obstacle.ccwRotationDegrees ?? 0)) return []
          const connectionName = native.connectedTo[0] ?? native.obstacleId ?? `pipeline9_obstacle_${native.center.x}_${native.center.y}`
          if (connectionName !== obstacle.connectionName || (hd.connMap.getNetConnectedToId(connectionName) ?? connectionName) !== obstacle.rootConnectionName) return []
          const availableZ = new Set(hd.activeNode.availableZ ?? hd.activeNode.portPoints.map((point: RuntimeObject) => point.z))
          const layers = (native.zLayers ?? native.layers.map((layer: string) => layer === "top" ? 0 : layer === "bottom" ? hd.layerCount - 1 : Number(layer.replace("inner", "")))).filter((z: number) => availableZ.has(z))
          if (JSON.stringify(layers) !== JSON.stringify(obstacle.zLayers)) return []
          return [{ nativeIndex, shape: native.shape ?? "rect", componentId: native.componentId, circuitJsonMetadata: copyData(native.circuitJsonMetadata) }]
        })
        return [{ convertedIndex, convertedType: obstacle.type, matches }]
      })
    } else {
      record.fixedRouteSections = copyData(hd.activeFallbackFixedRouteSections)
      record.fixedObstacleRoutes = copyData(hd.activeFallbackFixedObstacleRoutes)
      record.promotedConnectionNames = copyData(hd.activeFallbackPromotedFixedRouteConnectionNames)
    }
    const entry: ObservedAttempt = { solver, kind, record, retained: false }
    attempts.set(solver, entry)
    activeAttempts.add(entry)
    if (kind === "regional") lastRegional = entry
  }
}

function retain(entry: ObservedAttempt): void {
  if (entry.retained) return
  entry.record.final = state(entry.solver)
  entry.record.failureTree = failureTree(entry.solver)
  const row: RuntimeObject = {}
  for (const [key, value] of Object.entries(entry.record)) {
    if (key === "parent") {
      const parent = value as RuntimeObject
      row[key] = storeRecordFields({ ...parent, parameters: storeRecordFields(parent.parameters) })
    } else if (key === "constructorParameters") {
      row[key] = storeRecordFields(value as RuntimeObject)
    } else {
      row[key] = value !== null && typeof value === "object" ? storeEncoded(value) : value
    }
  }
  retainedAttempts.push(row)
  entry.retained = true
}

function observeAfter(): void {
  for (const entry of activeAttempts) {
    if (!entry.solver.failed && !entry.solver.solved) continue
    if (entry.kind === "b01" && entry.solver.failed) {
      failedB01Count++
      assert(failedB01Count <= 4, "More than four failed target B01 attempts; capture needs review")
      retain(entry)
    }
    if (entry.kind === "regional" && entry.solver.failed) retain(entry)
    activeAttempts.delete(entry)
  }
  observeBefore()
}

const started = performance.now()
let lastYield = started
let lastPhase: string | undefined
try {
  while (!pipeline.solved && !pipeline.failed && performance.now() - started < deadlineMs) {
    const phase = pipeline.getCurrentPhase()
    if (phase !== lastPhase) {
      phaseTransitions.push({ phase, iterations: pipeline.iterations, elapsedMs: performance.now() - started })
      lastPhase = phase
    }
    let observedAt = performance.now()
    observeBefore()
    observationMs += performance.now() - observedAt
    try { pipeline.step() }
    finally {
      observedAt = performance.now()
      observeAfter()
      observationMs += performance.now() - observedAt
    }
    if (performance.now() - lastYield >= 16) {
      await new Promise<void>((done) => setTimeout(done, 0))
      lastYield = performance.now()
    }
  }
} catch (error) {
  executionError = String(error)
}
try {
  if (lastRegional && !lastRegional.retained) retain(lastRegional)
} catch (error) { captureError = String(error) }

const summary = {
  schemaVersion: 1,
  diagnostic: "published Pipeline9 standalone phase replay; read-only before/after observations",
  modulePath, entrySha256: sha(entryBytes), inputPath,
  inputCompressedSha256: sha(compressedInput), inputSha256: sha(inputBytes),
  inputConnections: input.connections.length, inputObstacles: input.obstacles.length,
  targetRoot, nativeTarget: input.connections.find((connection: RuntimeObject) => connection.name === targetRoot),
  suppliedOptions: copyData(options), effectiveOptions: copyData(pipeline.opts), effectiveEffort: pipeline.effort,
  deadlineMs, elapsedMs: performance.now() - started, observationMs,
  pipeline: state(pipeline), activePhase: pipeline.getCurrentPhase(),
  highDensity: pipeline.highDensityRouteSolver ? state(pipeline.highDensityRouteSolver) : null,
  targetNodesEncountered: targetNodeIds.size, targetNodeIds: [...targetNodeIds], observedAttempts, failedB01Count,
  retainedAttempts: retainedAttempts.map((attempt) => ({ id: attempt.id, kind: attempt.kind })),
  outcome: executionError ? "execution_error" : pipeline.solved ? "pipeline_solved" : pipeline.failed ? "pipeline_failed" : "diagnostic_deadline",
  targetEncountered: targetNodeIds.size > 0,
  executionError, captureError, wasmAttempts, coldImportWasmCalls, phaseTransitions, serializedBytes,
}
const diagnostic = { summary, attempts: retainedAttempts, blobs }
const diagnosticBytes = Buffer.from(JSON.stringify(diagnostic))
const compressedDiagnostic = gzipSync(diagnosticBytes, { level: 9 })
if (pipeline.solved && !executionError && !captureError) {
  const output = Buffer.from(JSON.stringify(pipeline.getOutputSimpleRouteJson()))
  writeFileSync(resolve(outputDirectory, "phase-output.srj.json.gz"), gzipSync(output, { level: 9 }))
}
writeFileSync(resolve(outputDirectory, "hd-capture.json.gz"), compressedDiagnostic)
writeFileSync(resolve(outputDirectory, "summary.json"), JSON.stringify({ ...summary, captureSha256: sha(diagnosticBytes), captureGzipSha256: sha(compressedDiagnostic), captureGzipBytes: compressedDiagnostic.length }, null, 2) + "\n")
console.log(JSON.stringify({ ...summary, phaseTransitions: undefined }, null, 2))
if (executionError || captureError || wasmAttempts.length > 0) process.exitCode = 1
