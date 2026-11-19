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
assert(["base", "candidate"].includes(variant))
const planPath = resolve(flags["--plan"]!)
const planBytes = readFileSync(planPath)
const plan = JSON.parse(planBytes.toString())
assert.equal(plan.qualificationReady, true, "Screen remains held")
assert.equal(plan.captureDeadlineMs, 900000)
assert.equal(plan.hardDeadlineSeconds, 960)
const sha = (bytes: string | Buffer): string => createHash("sha256").update(bytes).digest("hex")
const mapBytes = readFileSync(resolve(dirname(planPath), "uniform-point-map.json"))
assert.equal(sha(mapBytes), plan.pointMapSha256)
assert.equal(sha(mapBytes), "0e4e137137ed869df44507e6bcd115993c970e7e6cfbba23763bf733341b4f97")
const pointMap = JSON.parse(mapBytes.toString())
assert.equal(pointMap.changes.length, 2)
const inputPath = resolve(flags["--input"]!)
const inputCompressed = readFileSync(inputPath)
const inputBytes = gunzipSync(inputCompressed)
assert.equal(sha(inputBytes), "948b9a36ed10b2132947dd6d5fe0a2132b99ccb341be1698f8b509fd9a63608c")
const input = JSON.parse(inputBytes.toString())
const inputCanonical = JSON.stringify(input)
const modulePath = resolve(flags["--module"]!)
const moduleBytes = readFileSync(modulePath)
assert.equal(sha(moduleBytes), "5695c6361c0f7a7dc26ddd1b9264b8a8c122e5f7b9610cf24c6af3b99c545df1")
const manifest = JSON.parse(readFileSync(resolve(flags["--manifest"]!), "utf8"))
assert.equal(manifest.mainVersion, "0.0.3242")
assert.equal(manifest.sourceOverrides, false)
assert.deepEqual(manifest.dependencyOverrides, [])
const autorouter = manifest.packages.find((item: Data) => item.name === "@tscircuit/capacity-autorouter")
assert.equal(autorouter.entry, modulePath)
assert.equal(autorouter.entrySha256, sha(moduleBytes))
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
let intervention: Data | null = null

// Diagnostic intervention only. Published source and the raw phase SRJ are untouched.
function inspectUniformBoundary(): void {
  const uniform = pipeline.uniformPortDistributionSolver
  if (intervention || !uniform?.solved) return
  assert.equal(pipeline.activeSubSolver, null)
  assert.equal(pipeline.getCurrentPhase(), "highDensityRouteSolver")
  assert.equal(pipeline.highDensityRouteSolver, undefined)
  const originalNodes = uniform.redistributedNodes
  const beforeNodesSnapshot: Data[] = structuredClone(originalNodes)
  const beforeNodes = JSON.stringify(originalNodes)
  const expectedNodes: Data[] = structuredClone(originalNodes)
  const beforeFamilies = JSON.stringify([...uniform.mapOfOwnerPairToPortPoints])
  const internalInputsBefore = JSON.stringify([pipeline.originalSrj, pipeline.srj, pipeline.srjWithPointPairs])
  const changes: Data[] = []
  for (const change of pointMap.changes) {
    const original = change.originalCoordinatesExact
    const replacement = change.replacementCoordinates
    assert.equal(replacement.x, original.x)
    assert.equal(replacement.z, original.z)
    assert(replacement.y >= change.sharedEdge.y1 && replacement.y <= change.sharedEdge.y2)
    const owners: string[] = []
    let pairedCopies = 0
    const pointsToUpdate = new Set<Data>()
    const checkPoint = (point: Data): void => {
      assert.equal(point.connectionName, change.connectionName)
      assert.deepEqual({ x: point.x, y: point.y, z: point.z }, original)
    }
    for (const node of expectedNodes) {
      const points = node.portPoints.filter((point: Data) => point.portPointId === change.portPointId)
      if (points.length === 0) continue
      assert.equal(points.length, 1)
      assert(change.expectedOwnerNodeIds.includes(node.capacityMeshNodeId))
      owners.push(node.capacityMeshNodeId)
      const point = points[0]
      checkPoint(point)
      const expectedOwner = change.capturedOwnerCopies.find((owner: Data) => owner.ownerNodeId === node.capacityMeshNodeId)
      assert.equal(point.rootConnectionName, expectedOwner.rootConnectionName)
      changes.push({ portPointId: point.portPointId, ownerNodeId: node.capacityMeshNodeId, before: { x: point.x, y: point.y, z: point.z }, after: variant === "candidate" ? replacement : original })
      pointsToUpdate.add(point)
      for (const pair of node.portPointsInPairs ?? []) for (const paired of pair) {
        if (paired.portPointId !== change.portPointId) continue
        checkPoint(paired)
        pairedCopies++
        pointsToUpdate.add(paired)
      }
    }
    assert.deepEqual(owners.sort(), [...change.expectedOwnerNodeIds].sort())
    assert.equal(owners.length, change.expectedUniqueOwningNodeCount)
    assert(pairedCopies >= owners.length, "Both owner pair representations must retain the crossing")
    if (variant === "candidate") for (const point of pointsToUpdate) point.y = replacement.y
  }
  if (variant === "candidate") uniform.redistributedNodes = expectedNodes
  const restoredNodes: Data[] = structuredClone(uniform.redistributedNodes)
  for (const change of pointMap.changes) {
    const pointsToRestore = new Set<Data>()
    for (const node of restoredNodes) {
      for (const point of [...node.portPoints, ...(node.portPointsInPairs ?? []).flat()]) {
        if (point.portPointId !== change.portPointId) continue
        const expected = variant === "candidate" ? change.replacementCoordinates : change.originalCoordinatesExact
        assert.deepEqual({ x: point.x, y: point.y, z: point.z }, expected)
        pointsToRestore.add(point)
      }
    }
    for (const point of pointsToRestore) point.y = change.originalCoordinatesExact.y
  }
  assert.deepEqual(restoredNodes, beforeNodesSnapshot, "Unexpected node, pair, identifier, or coordinate change")
  assert.deepEqual(originalNodes, beforeNodesSnapshot, "Intervention changed original/coarse point objects")
  assert.equal(JSON.stringify([...uniform.mapOfOwnerPairToPortPoints]), beforeFamilies, "Intervention changed owner-family map")
  assert.equal(JSON.stringify([pipeline.originalSrj, pipeline.srj, pipeline.srjWithPointPairs]), internalInputsBefore, "Intervention changed native SRJ/copper")
  assert.equal(JSON.stringify(input), inputCanonical)
  assert.equal(changes.length, 4)
  intervention = {
    variant, applied: variant === "candidate", exactCoordinateDiffVerified: true,
    changedUniquePortIds: variant === "candidate" ? 2 : 0,
    changedOwnerPortRecords: variant === "candidate" ? 4 : 0,
    changes, beforeNodesSha256: sha(beforeNodes), afterNodesSha256: sha(JSON.stringify(uniform.redistributedNodes)),
    beforeFamiliesSha256: sha(beforeFamilies), afterFamiliesSha256: sha(JSON.stringify([...uniform.mapOfOwnerPairToPortPoints])),
    nativeInputsUnchanged: true, ownerFamilyMapUnchanged: true, originalCoarsePointsUnchanged: true, allOtherNodeAndPairDataUnchanged: true,
    appliedBeforeHdConstruction: true, pointMapSha256: sha(mapBytes),
    runtimeCaveat: pointMap.criticalRuntimeCaveat,
    interventionKind: "Diagnostic replacement of cloned Uniform output only; not a production implementation.",
  }
  write("intervention.json", intervention)
}

const started = performance.now()
let lastFlush = started
let lastPhase: string | undefined
const phaseTransitions: Data[] = []
let timedOut = false
let thrownError: string | null = null
let outputSha256: string | null = null
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
      pipeline.step()
      inspectUniformBoundary()
      const phase = pipeline.getCurrentPhase()
      if (phase !== lastPhase) {
        phaseTransitions.push({ phase, elapsedMs: performance.now() - started, iterations: pipeline.iterations })
        lastPhase = phase
      }
      if (performance.now() - started >= plan.captureDeadlineMs) { timedOut = true; break }
    } while (!pipeline.solved && !pipeline.failed && performance.now() - batchStarted < 250)
    if (performance.now() - lastFlush >= 10000) {
      write("progress.json", state())
      lastFlush = performance.now()
    }
    if (timedOut) break
    if (!pipeline.solved && !pipeline.failed) await new Promise<void>(done => setTimeout(done, 0))
  }
  if (pipeline.solved && !pipeline.failed && !timedOut) {
    assert(intervention, "Full phase solved without the required Uniform boundary")
    const output = JSON.stringify(pipeline.getOutputSimpleRouteJson())
    outputSha256 = sha(output)
    writeFileSync(resolve(outputDirectory, "phase-output.srj.json.gz"), gzipSync(output))
  }
} catch (error) {
  thrownError = error instanceof Error ? `${error.message}\n${error.stack ?? ""}`.slice(0, 8000) : String(error)
}
const report = {
  schemaVersion: 1, variant, ...state(), timedOut, thrownError, outputSha256,
  inputSha256: sha(inputBytes), inputCompressedSha256: sha(inputCompressed),
  initialInputCanonicalSha256: sha(inputCanonical), finalInputCanonicalSha256: sha(JSON.stringify(input)),
  inputFileUnchanged: sha(readFileSync(inputPath)) === sha(inputCompressed),
  autorouterEntrySha256: sha(moduleBytes), autorouterEntryUnchanged: sha(readFileSync(modulePath)) === sha(moduleBytes),
  planSha256: sha(planBytes), pointMapSha256: sha(mapBytes),
  suppliedOptions: { cacheProvider: null }, undefinedOptionKeys: ["capacityDepth", "targetMinCapacity", "effort"],
  effectiveOptions: pipeline.opts, effectiveEffort: pipeline.effort,
  captureDeadlineMs: plan.captureDeadlineMs, hardDeadlineSeconds: plan.hardDeadlineSeconds,
  intervention, phaseTransitions, wasmAttempts, coldImportWasmCalls,
  scope: "Causal point-placement diagnostic on the full native phase; not a production source fix or a full-board gain.",
}
write("report.json", report)
console.log(JSON.stringify({ variant, solved: report.solved, failed: report.failed, error: report.error, timedOut, thrownError, outputSha256, elapsedMs: report.elapsedMs }))
if (thrownError || wasmAttempts.length || !report.inputFileUnchanged || !report.autorouterEntryUnchanged || report.initialInputCanonicalSha256 !== report.finalInputCanonicalSha256) process.exitCode = 1
