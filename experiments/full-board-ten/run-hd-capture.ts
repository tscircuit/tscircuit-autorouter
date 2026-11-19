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
let nativePathCapture: RuntimeObject | null = null
let preUniformNodes: RuntimeObject[] = []
let uniformInputNodes: RuntimeObject[] = []
let previousFailedB01Count = 0
const failedB01Events: RuntimeObject[] = []
const regionalEvents: RuntimeObject[] = []
const regionalInstances = new Map<RuntimeObject, RuntimeObject>()
let postUniformCaptured = false
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
    preUniformNodes = copyData(uniform.input.nodeWithPortPoints)
    uniformInputNodes = copyData(uniform.input.inputNodesWithPortPoints)
    const pairs = pipeline.srjWithPointPairs.connections.filter((connection: RuntimeObject) => connection.name === primaryTargetConnection || connection.rootConnectionName === targetRoot || connection.name.startsWith(`${targetRoot}_mst`))
    assert.equal(pairs.filter((connection: RuntimeObject) => connection.name === primaryTargetConnection).length, 1, "Exact native target MST pair is missing")
    nativePathCapture = storeRecordFields({
      primaryTargetConnection,
      sourceConnection: copyData(input.connections.find((connection: RuntimeObject) => connection.name === targetRoot)),
      pointPairs: copyData(pairs),
      preUniformNodes: copyData(preUniformNodes.filter((node: RuntimeObject) => node.capacityMeshNodeId === fallbackTargetNode || node.portPoints.some((point: RuntimeObject) => point.connectionName === primaryTargetConnection || point.rootConnectionName === targetRoot))),
      inputNodesWithPortPoints: copyData(uniformInputNodes),
    })
    uniformCaptured = true
  }
  if (uniform?.solved && nativePathCapture && !postUniformCaptured) {
    nativePathCapture.postUniformNodes = storeEncoded(copyData(uniform.redistributedNodes.filter((node: RuntimeObject) => node.capacityMeshNodeId === fallbackTargetNode || node.portPoints.some((point: RuntimeObject) => point.connectionName === primaryTargetConnection || point.rootConnectionName === targetRoot))))
    postUniformCaptured = true
  }
  const hd = pipeline.highDensityRouteSolver
  if (!hd?.activeNode) return
  const regional = hd.activeFallbackSolver
  if (regional && !regionalInstances.has(regional)) {
    assert.equal(regional.iterations, 0, "Regional accounting must begin at construction")
    assert(regionalEvents.length < 64, "Regional attempt accounting limit exceeded")
    const latestFailure = failedB01Events.at(-1)
    const event: RuntimeObject = {
      id: regionalEvents.length,
      parentNodeId: hd.activeNode.capacityMeshNodeId,
      regionalNodeId: regional.params.nodeWithPortPoints.capacityMeshNodeId,
      parentRootConnectionNames: [...new Set(hd.activeNode.portPoints.map((point: RuntimeObject) => point.rootConnectionName ?? point.connectionName))],
      regionalRootConnectionNames: [...new Set(regional.params.nodeWithPortPoints.portPoints.map((point: RuntimeObject) => point.rootConnectionName ?? point.connectionName))],
      reason: hd.activeFallbackReason,
      triggeringB01FailureIndex: latestFailure?.nodeId === hd.activeNode.capacityMeshNodeId && hd.activeFallbackReason === `B01 failed: ${latestFailure.state.error}` ? failedB01Events.length - 1 : null,
      initial: state(regional),
      solvedNodeCountBefore: hd.stats.solvedNodeCount,
      acceptedRouteCountBefore: hd.routes.length,
      fixedRouteReplacementKeysBefore: [...hd.fixedRouteReplacements.keys()],
      promotedConnectionNames: [...hd.activeFallbackPromotedFixedRouteConnectionNames],
      parentOutcome: "active",
    }
    regionalEvents.push(event)
    regionalInstances.set(regional, event)
  }
  const matchesPrimaryRoot = containsTarget(hd.activeNode, hd)
  const matchesFallbackNode = hd.activeNode.capacityMeshNodeId === fallbackTargetNode || hd.activeFallbackSolver?.params.nodeWithPortPoints.capacityMeshNodeId === fallbackTargetNode
  if (!matchesPrimaryRoot && !matchesFallbackNode) return
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
      selection: { matchesPrimaryRoot, matchesFallbackNode },
      nodeRootConnectionNames: [...new Set(hd.activeNode.portPoints.map((point: RuntimeObject) => point.rootConnectionName ?? point.connectionName))],
      primaryPointPair: copyData(pipeline.srjWithPointPairs.connections.find((connection: RuntimeObject) => connection.name === primaryTargetConnection)),
      preUniformNode: copyData(preUniformNodes.find((node: RuntimeObject) => node.capacityMeshNodeId === hd.activeNode.capacityMeshNodeId)),
      postUniformNode: copyData(uniform.redistributedNodes.find((node: RuntimeObject) => node.capacityMeshNodeId === hd.activeNode.capacityMeshNodeId)),
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
  if (entry.kind === "b01" && entry.solver.iterations > 0) {
    entry.record.failedSearch = {
      activeConnection: copyData(entry.solver.activeConnection),
      unsolvedSegments: copyData(entry.solver.unsolvedConnections),
      connectionNames: copyData(entry.solver.connIdToName),
      connectionRoots: copyData(entry.solver.connIdToRootNet),
      searchIterations: entry.solver.searchIterations,
      baseSearchBudgetIters: entry.solver.baseSearchBudgetIters,
      totalRipEvents: entry.solver.totalRipEvents,
    }
  }
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
  const hd = pipeline.highDensityRouteSolver
  if (hd) {
    for (const solver of hd.failedSolvers.slice(previousFailedB01Count)) {
      const params = solver.getConstructorParams()[0]
      const node = params.nodeWithPortPoints
      failedB01Events.push({
        state: state(solver),
        nodeId: node.capacityMeshNodeId,
        rootConnectionNames: [...new Set(node.portPoints.map((point: RuntimeObject) => point.rootConnectionName ?? point.connectionName))],
        selectedAttemptId: attempts.get(solver)?.record.id ?? null,
      })
      if (solver.error?.includes(primaryTargetConnection)) assert(attempts.has(solver), "Primary failed B01 constructor was not captured")
    }
    previousFailedB01Count = hd.failedSolvers.length
    for (const [solver, event] of regionalInstances) {
      if (event.parentOutcome !== "active") continue
      if (!solver.solved && !solver.failed && hd.activeFallbackSolver === solver) continue
      event.final = state(solver)
      event.parentStateAfter = state(hd)
      event.solvedNodeCountAfter = hd.stats.solvedNodeCount
      event.acceptedRouteCountAfter = hd.routes.length
      event.parentOutcome = hd.failed ? "parent_failed" : Number(hd.stats.solvedNodeCount) === Number(event.solvedNodeCountBefore) + 1 && hd.activeNode === null && hd.activeFallbackSolver === null ? "node_accepted" : hd.activeFallbackSolver !== solver ? "replaced_by_regional_retry" : "terminal_solver_still_active"
      event.fixedRouteReplacementKeysAfter = [...hd.fixedRouteReplacements.keys()]
      if (attempts.has(solver) && event.parentOutcome === "node_accepted") {
        event.acceptedRoutes = storeEncoded(copyData(hd.routes.slice(event.acceptedRouteCountBefore)))
      }
    }
  }
  for (const entry of activeAttempts) {
    if (!entry.solver.failed && !entry.solver.solved) continue
    if (entry.kind === "b01" && entry.solver.failed) {
      failedB01Count++
      retain(entry)
    }
    if (entry.kind === "regional") retain(entry)
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
  for (const entry of activeAttempts) retain(entry)
  if (lastRegional && !lastRegional.retained) retain(lastRegional)
} catch (error) { captureError = String(error) }

let completedOutput: Buffer | undefined
try {
  if (pipeline.solved && !executionError && !captureError) {
    const outputJson = JSON.stringify(pipeline.getOutputSimpleRouteJson())
    completedOutput = Buffer.from(outputJson)
  }
} catch (error) { captureError = String(error) }

const summary = {
  schemaVersion: 2,
  diagnostic: "published Pipeline9 standalone phase replay; read-only before/after observations",
  planSha256: sha(planBytes),
  modulePath, entrySha256: sha(entryBytes), inputPath,
  inputCompressedSha256: sha(compressedInput), inputSha256: sha(inputBytes),
  inputConnections: input.connections.length, inputObstacles: input.obstacles.length,
  inputTerminals: 143, inputPreloadedTraces: input.traces.length,
  initialInputCanonicalSha256, finalInputCanonicalSha256: sha(JSON.stringify(input)),
  inputFileUnchanged: sha(readFileSync(inputPath)) === sha(compressedInput),
  autorouterEntryUnchanged: sha(readFileSync(modulePath)) === sha(entryBytes),
  coreEntryUnchanged: sha(readFileSync(publishedCore.entry)) === publishedCore.entrySha256,
  primaryTargetConnection, fallbackTargetNode,
  targetsAreIndependent: true,
  targetRoot, nativeTarget: input.connections.find((connection: RuntimeObject) => connection.name === targetRoot),
  suppliedOptions: copyData(options), effectiveOptions: copyData(pipeline.opts), effectiveEffort: pipeline.effort,
  deadlineMs, elapsedMs: performance.now() - started, observationMs,
  pipeline: state(pipeline), activePhase: pipeline.getCurrentPhase(),
  highDensity: pipeline.highDensityRouteSolver ? state(pipeline.highDensityRouteSolver) : null,
  targetNodesEncountered: targetNodeIds.size, targetNodeIds: [...targetNodeIds], observedAttempts, failedB01Count,
  retainedAttempts: retainedAttempts.map((attempt) => ({ id: attempt.id, kind: attempt.kind })),
  failedB01Events, regionalEvents,
  nativePathCaptured: nativePathCapture !== null, postUniformCaptured,
  outcome: executionError || captureError ? "execution_error" : pipeline.solved ? "pipeline_solved" : pipeline.failed ? "pipeline_failed" : "diagnostic_deadline",
  targetEncountered: targetNodeIds.size > 0,
  executionError, captureError, wasmAttempts, coldImportWasmCalls, phaseTransitions, serializedBytes,
  failedNode: pipeline.highDensityRouteSolver?.failed ? copyData(pipeline.highDensityRouteSolver.activeNode) : null,
  finalHighDensityAccounting: pipeline.highDensityRouteSolver ? {
    stats: copyData(pipeline.highDensityRouteSolver.stats),
    acceptedRouteCount: pipeline.highDensityRouteSolver.routes.length,
    pendingNodeIds: pipeline.highDensityRouteSolver.unsolvedNodePortPoints.map((node: RuntimeObject) => node.capacityMeshNodeId),
    finalRegionalFailureIds: regionalEvents.filter((event) => event.parentOutcome === "parent_failed").map((event) => event.id),
  } : null,
}
const diagnostic = { summary, nativePathCapture, attempts: retainedAttempts, blobs }
const diagnosticBytes = Buffer.from(JSON.stringify(diagnostic))
const compressedDiagnostic = gzipSync(diagnosticBytes, { level: 9 })
if (completedOutput) writeFileSync(resolve(outputDirectory, "phase-output.srj.json.gz"), gzipSync(completedOutput, { level: 9 }))
writeFileSync(resolve(outputDirectory, "hd-capture.json.gz"), compressedDiagnostic)
writeFileSync(resolve(outputDirectory, "summary.json"), JSON.stringify({ ...summary, captureSha256: sha(diagnosticBytes), captureGzipSha256: sha(compressedDiagnostic), captureGzipBytes: compressedDiagnostic.length }, null, 2) + "\n")
console.log(JSON.stringify({ ...summary, phaseTransitions: undefined }, null, 2))
if (executionError || captureError || wasmAttempts.length > 0) process.exitCode = 1
