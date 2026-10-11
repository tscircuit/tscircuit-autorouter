import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import type { AnyCircuitElement } from "circuit-json"

type Capture = { number: number; circuitJson: AnyCircuitElement[]; options: Record<string, unknown>; expected: unknown }
type SourceKind = "checker" | "index" | "via" | "planner" | "trace" | "polygon" | "memo" | "guard" | "lazy" | "snapshots"
type Memo = { diagnostics: unknown; identities: Map<unknown, unknown>; values: Map<unknown, unknown>; nextIdentity: number }
type PolygonMemo = { diagnostics: unknown; retainedEdges: number; rows: Map<number, { edges: number; polygon?: unknown }> }
type EvidenceModule = { census: Record<string, number>; latestPrivateMemo: Memo; latestPhysicalMap: { connMap: unknown; traceIdToElm: Map<string, unknown> }; getPolygonMemo(memo: Memo): PolygonMemo | undefined; createPrivatelyMemoizedTraceContinuityChecker(): (input: AnyCircuitElement[]) => unknown; configurePreparedPrivatelyMemoizedTraceContinuityChecker(checker: unknown, executor: unknown): boolean }
const sourceRoot = process.env.REFERENCE_PROFILE_ROOT, expectedRevision = process.env.REFERENCE_PROFILE_SHA
if (!sourceRoot || !expectedRevision) throw new Error("REFERENCE_PROFILE_ROOT/SHA must identify immutable source")
const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: sourceRoot, stdout: "pipe", stderr: "pipe" })
assert.equal(git.exitCode, 0)
assert.equal(new TextDecoder().decode(git.stdout).trim(), expectedRevision)
const directory = resolve(process.env.REFERENCE_CENSUS_OUTPUT ?? "/tmp/native-reference-main-census")
await mkdir(directory, { recursive: true })
const parallel = join(sourceRoot, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel"), fork = join(parallel, "authoritative-drc-fork")
const sources: Record<SourceKind, string> = {
  checker: join(fork, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts"),
  index: join(fork, "native/lib/util/create-indexed-pcb-connectivity-map.ts"),
  via: join(fork, "native/lib/util/get-via-and-pour-connections.ts"),
  planner: join(fork, "referenceDrcPrimitiveMissPlanning.ts"),
  trace: join(fork, "prepareReferenceDrcTracePairFacts.ts"), polygon: join(fork, "prepareReferenceDrcPolygonFacts.ts"),
  memo: join(fork, "ReferenceDrcPrimitiveMemo.ts"), guard: join(fork, "canUseExpectedPortsMemo.ts"),
  lazy: join(fork, "canUseLazyViaTraceCenters.ts"), snapshots: join(fork, "referenceDrcPolygonFacts.ts"),
}
const hashes: Record<string, string> = {}
for (const path of Object.values(sources)) hashes[relative(sourceRoot, path)] = createHash("sha256").update(new Uint8Array(await readFile(path))).digest("hex")
const nativeDirectory = await mkdtemp(join(tmpdir(), "reference-census-native-"))
const censusDirectory = await mkdtemp(join(tmpdir(), "reference-census-counted-"))
await symlink(join(sourceRoot, "node_modules"), join(nativeDirectory, "node_modules"))
await symlink(join(sourceRoot, "node_modules"), join(censusDirectory, "node_modules"))
const controlPaths = await writeEvidenceSources(sources, nativeDirectory, false)
const censusPaths = await writeEvidenceSources(sources, censusDirectory, true)
const nativeModule = await import(controlPaths.checker) as EvidenceModule
const nativeIndex = await import(controlPaths.index) as EvidenceModule
const candidateModule = await import(censusPaths.checker) as EvidenceModule
const candidateIndex = await import(censusPaths.index) as EvidenceModule
const counted: Partial<Record<SourceKind, EvidenceModule>> = {}
for (const kind of Object.keys(censusPaths) as SourceKind[]) counted[kind] = await import(censusPaths[kind]) as EvidenceModule
const { Pipeline9LocalWorkerPool } = await import(join(parallel, "Pipeline9LocalWorkerPool.ts"))
const { createNativeSyncReferenceFactExecutor } = await import(join(parallel, "NativeSyncReferenceBatchTransport.ts"))
const { getDrcErrors } = await import(join(sourceRoot, "lib/testing/getDrcErrors.ts"))
const { checkViaTraceClearanceWithLazyCenters } = await import(join(fork, "checkViaTraceClearanceWithLazyCenters.ts"))
const { captureReferenceDrcPolygonSnapshot } = await import(join(fork, "referenceDrcPolygonFacts.ts"))
const { captureNativeSourceAliasProvenance } = await import(join(parallel, "nativeSourceAliasProvenance.ts"))
const capturePath = join(sourceRoot, "tests/fixtures/reference-drc-srj18/sample015-native-reference.json.gz")
const captureBytes = new Uint8Array(await readFile(capturePath))
const captures = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(captureBytes))) as { records: Capture[] }
assert.equal(captures.records.length, 17)
const native = nativeModule.createPrivatelyMemoizedTraceContinuityChecker(), nativeMemo = nativeModule.latestPrivateMemo
const candidate = candidateModule.createPrivatelyMemoizedTraceContinuityChecker(), candidateMemo = candidateModule.latestPrivateMemo
const pool = new Pipeline9LocalWorkerPool({ workerCount: 4 })
await pool.initializeReferenceTransport()
await pool.warmup()
const executor = createNativeSyncReferenceFactExecutor(pool)
assert(executor !== undefined)
assert(candidateModule.configurePreparedPrivatelyMemoizedTraceContinuityChecker(candidate, executor))
const memoState = (memo: Memo): unknown => ({ diagnostics: { ...(memo.diagnostics as object) }, identities: [...memo.identities], values: [...memo.values], nextIdentity: memo.nextIdentity })
const polygonState = (memo: PolygonMemo | undefined): unknown => memo === undefined ? undefined : ({ diagnostics: { ...(memo.diagnostics as object) }, retainedEdges: memo.retainedEdges, rows: [...memo.rows].map(([id, row]) => [id, { edges: row.edges, polygon: row.polygon === undefined ? undefined : captureReferenceDrcPolygonSnapshot(row.polygon) }]) })
const records: unknown[] = []
let previous: Record<string, number> = {}
try {
  for (const capture of captures.records) {
    const nativeInput = structuredClone(capture.circuitJson), candidateInput = structuredClone(capture.circuitJson)
    const options = { ...capture.options, viaTraceChecker: (input: AnyCircuitElement[], options: object): ReturnType<typeof checkViaTraceClearanceWithLazyCenters> => checkViaTraceClearanceWithLazyCenters(input, { ...options, enableAxisRejection: true, enableConnectivityMemo: true }) }
    const before = pool.getNativeReferenceFactStats()!
    const expected = getDrcErrors(nativeInput, { ...options, traceContinuityChecker: native })
    ;(counted.memo as unknown as { resetInternIdentityCensus(): void }).resetInternIdentityCensus()
    const actual = getDrcErrors(candidateInput, { ...options, traceContinuityChecker: candidate })
    assert.deepStrictEqual(JSON.parse(JSON.stringify(expected)), capture.expected)
    assert.deepStrictEqual(actual, expected)
    assert.deepStrictEqual(candidateInput, nativeInput)
    assert.deepStrictEqual(captureNativeSourceAliasProvenance(actual, candidateInput), captureNativeSourceAliasProvenance(expected, nativeInput))
    assert.deepStrictEqual(memoState(candidateMemo), memoState(nativeMemo))
    assert.deepStrictEqual(polygonState(candidateModule.getPolygonMemo(candidateMemo)), polygonState(nativeModule.getPolygonMemo(nativeMemo)))
    if (candidateInput.some((element) => element.type === "pcb_trace")) {
      assert.deepStrictEqual(candidateIndex.latestPhysicalMap.connMap, nativeIndex.latestPhysicalMap.connMap)
      for (const [id, trace] of candidateIndex.latestPhysicalMap.traceIdToElm) assert.equal(trace, candidateInput.find((element) => element.type === "pcb_trace" && element.pcb_trace_id === id))
    }
    const current = collectCounts(counted), delta: Record<string, number> = {}
    for (const [key, value] of Object.entries(current)) delta[key] = value - (previous[key] ?? 0)
    previous = current
    const after = pool.getNativeReferenceFactStats()!
    assert.equal(after.workersReserved, after.workersRetired)
    assert.equal(after.protocolFaults, 0)
    records.push({ number: capture.number, operations: delta, primitiveMemoDiagnostics: { ...(candidateMemo.diagnostics as object) }, scaledMemoDiagnostics: { ...(candidateModule.getPolygonMemo(candidateMemo)?.diagnostics as object) }, factRows: after.mainFactRowsCompleted + after.workerFactRowsCompleted - before.mainFactRowsCompleted - before.workerFactRowsCompleted, batches: after.batchesCompleted - before.batchesCompleted })
  }
  const stats = pool.getNativeReferenceFactStats()!
  assert.equal(stats.batchesCompleted, 26)
  assert.equal(stats.workerFactRowsCompleted + stats.mainFactRowsCompleted, 28116)
  assert.equal(stats.workersReserved, 78)
  assert.equal(stats.workersRetired, 78)
  assert.equal(stats.maxFactWorkerLanes, 3)
  assert.equal(stats.mainFactLaneCount, 1)
  const proof = {
    kind: "Time-free Native reference main-thread operation census; exact source-local counter replay",
    sourceRevision: expectedRevision, sourceRoot, bunVersion: Bun.version,
    scriptSha256: createHash("sha256").update(new Uint8Array(await readFile(import.meta.path))).digest("hex"),
    captureSha256: createHash("sha256").update(captureBytes).digest("hex"), sourceHashes: hashes,
    whole17NativeErrorsExact: true, postCircuitJsonExact: true, errorSourceAliasPathsExact: true,
    primitiveMemoValuesIdsFifoCountersExact: true, scaledPolygonRowsDiagnosticsRetainedEdgesExact: true,
    physicalNetIdsAndOriginalTraceAliasesExact: true, originalWarmPrivateMemoRetained: true,
    nativeMethodsWrapped: false, callbackCountersInstalled: false,
    admissionBypassed: false, genuineDefaultPoolExecutor: true,
    limitation: "Only source-local closed numeric counters and readonly evidence exports are added in isolated copies. The profiler uses untouched production instead. Counts are actual main Native loop/body visits; native geometry dependencies and worker calculations are not instrumented. Counts do not imply elapsed-time or speed improvement.",
    noLocalElapsedComparison: true, noSpeedClaim: true, totals: previous, factStats: stats, records,
  }
  await Bun.write(join(directory, "census.json"), JSON.stringify(proof, null, 2))
  console.log(JSON.stringify({ sourceRevision: expectedRevision, totals: previous, factStats: stats, directory }, null, 2))
} finally { pool.dispose() }

function collectCounts(modules: Partial<Record<SourceKind, EvidenceModule>>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [name, module] of Object.entries(modules)) {
    for (const [key, value] of Object.entries(module.census)) {
      assert(Number.isSafeInteger(value) && value >= 0)
      counts[`${name}.${key}`] = value
    }
  }
  return counts
}

async function writeEvidenceSources(sources: Record<SourceKind, string>, directory: string, counted: boolean): Promise<Record<SourceKind, string>> {
  const kinds: SourceKind[] = counted ? Object.keys(sources) as SourceKind[] : ["checker", "index", "via", "planner", "trace", "polygon"]
  const paths = Object.fromEntries(kinds.map((kind) => [kind, join(directory, `${kind}.ts`)])) as Record<SourceKind, string>
  for (const kind of kinds) {
    let source = await readFile(sources[kind], "utf8")
    if (counted) source = insertCounters(kind, source)
    if (kind === "checker") source = "export let latestPrivateMemo: unknown\nexport function getPolygonMemo(memo: any): any { return privatelyOwnedPolygonMemos.get(memo) }\n" + source.replaceAll("const primitiveMemo = new ReferenceDrcPrimitiveMemo()", "const primitiveMemo = new ReferenceDrcPrimitiveMemo()\n  latestPrivateMemo = primitiveMemo")
    if (kind === "index") source = "export let latestPhysicalMap: any\n" + source.replace("  return map\n", "  latestPhysicalMap = map\n  return map\n")
    source = source.replace(/from\s+"(\.[^"]+)"/g, (_match, spec: string): string => {
      const resolved = resolve(dirname(sources[kind]), spec)
      const matching = kinds.find((name) => sources[name] === resolved || sources[name] === `${resolved}.ts`)
      return `from ${JSON.stringify(matching === undefined ? resolved : paths[matching])}`
    })
    await writeFile(paths[kind], source)
  }
  return paths
}

function insertCounters(kind: SourceKind, input: string): string {
  let source = input
  const replacements: Partial<Record<SourceKind, [string, string][]>> = {
    memo: [
      ["function snapshotKey(value: unknown, visiting: Set<object>): CacheableSnapshot {", "snapshotCalls"],
      ["  const prototype = Object.getPrototypeOf(value)", "snapshotObjects"],
      ["    const descriptor = Object.getOwnPropertyDescriptor(value, property)!", "snapshotProperties"],
      ["    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {", "planRows"],
      ["      consume: <T>(kind: string, input: unknown, compute: () => T): T => {", "consumeRows"],
      ["  intern(value: unknown): number {", "internCalls"],
      ["  getOrCompute<T>(kind: string, input: unknown, compute: () => T): T {", "getCalls"],
    ],
    checker: [
      ["    while (pendingTraceIds.length > 0) {", "bfsPendingPops"],
      ["      connectedTraceIds.add(traceId)", "bfsUniqueTraceVisits"],
      ["          expandedPhysicalNetIds!.add(physicalNetId)", "physicalComponentExpansions"],
      ["        for (const connectedTrace of pcbConnectivityMap.getAllTracesConnectedToTrace(\n          traceId,\n        )) {", "physicalComponentMembers"],
      ["      for (const pcbPortId of touchedPortIdsByTraceId.get(traceId) ?? []) {", "touchedPortVisits"],
      ["        for (const touchingTraceId of traceIdsByTouchedPortId.get(pcbPortId) ??\n          []) {", "padAdjacentTraceVisits"],
      ["    for (const port of expectedPorts) {", "expectedPortVisits"],
      ["        for (const [pcbPortId, pads] of padMap) {", "endpointPadInventoryVisits"],
    ],
    index: [
      ["  for (const element of circuitJson) {", "circuitElementVisits"],
      ["    for (let i = 0; i < trace.route.length - 1; i++) {", "boundsRouteSegments"],
      ["      for (const hit of index.search(box.minX, box.minY, box.maxX, box.maxY)) {", "indexSearchHits"],
      ["    for (const j of [...neighbors].sort((a, b) => a - b)) {", "candidatePairsConsumed"],
      ["    for (const point of trace.route) {", "portRoutePoints"],
    ],
    via: [
      ["  const index = new Flatbush(conductors.length)", "conductorIndexes"],
      ["  for (const { polygon } of conductors) {", "conductorBounds"],
      ["      const b = conductors[j]", "nativeIndexSearchHits"],
    ],
    trace: [
      ["    for (let j = 0; j < neighbors.length; j++) {", "preparedCandidateRows"],
      ["      for (let pointIndex = 0; pointIndex < trace.route.length; pointIndex++) {", "geometryPointCopyVisits"],
    ],
    polygon: [
      ["    for (let k = 0; k < neighbors.length; k++) {", "preparedIndexSearchHits"],
      ["      pairs.push({ left: i, right: j })", "preparedCandidateRows"],
    ],
    guard: [
      ["export function canUseExpectedPortsMemo(circuitJson: unknown): boolean {", "calls"],
      ["    const snapshot = nativeSnapshots[index]!", "nativeTargetsChecked"],
      ["      const actual = getOwnPropertyDescriptor(snapshot.target, key)", "nativeDescriptorsChecked"],
    ],
    lazy: [
      ["function nativeExecutionIsUnchanged(): boolean {", "intrinsicGuardCalls"],
      ["    const snapshot = nativeDescriptors[index]!", "nativeTargetsChecked"],
      ["function isPlainFiniteData(value: unknown, visiting: Set<object>, checked: Set<object>, isProxy: ReferenceDrcProxyInspector): boolean {", "plainDataCalls"],
      ["    const property = properties[index]!\n    const descriptor = getOwnPropertyDescriptor(value, property)!", "plainDataProperties"],
    ],
    snapshots: [
      ["  for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {", "preparedPolygonsCopied"],
      ["        if (++edgeCount >= MAX_EDGES) return undefined", "preparedEdgesCopied"],
    ],
  }
  for (const [anchor, counter] of replacements[kind] ?? []) {
    assert.equal(source.split(anchor).length - 1, 1, `Counter anchor ${kind}.${counter} must occur exactly once`)
    let increment = `census.${counter} = (census.${counter} ?? 0) + 1;`
    if (kind === "memo") {
      const owners: Record<string, string> = { planRows: "plan", consumeRows: "consume", internCalls: "intern", getCalls: "get" }
      if (owners[counter] !== undefined) increment += ` snapshotOwner = ${JSON.stringify(owners[counter])};`
      if (counter.startsWith("snapshot")) increment += ` census[${JSON.stringify(`${counter}.`)} + snapshotOwner] = (census[${JSON.stringify(`${counter}.`)} + snapshotOwner] ?? 0) + 1;`
    }
    // Declaration anchors need the count before the declaration; loop/function
    // openings and completed native statements need it immediately afterward.
    source = source.replace(anchor, anchor.trimEnd().endsWith("{") || anchor.trimEnd().endsWith(")") || anchor.includes("return undefined") ? `${anchor}\n${increment}` : `${increment}\n${anchor}`)
  }

  if (kind === "memo") {
    const objectEntry = "  const prototype = Object.getPrototypeOf(value)"
    if (source.split(objectEntry).length - 1 !== 1) throw new Error("Expected one memo object entry")
    source = source.replace(objectEntry, `
  const identityEntry = snapshotOwner === "intern" ? internIdentityCache.get(value) : undefined
  const identityStartCalls = census.snapshotCalls ?? 0
  const identityStartProperties = census.snapshotProperties ?? 0
  const identityStartObjects = census.snapshotObjects ?? 0
  if (snapshotOwner === "intern") {
    census.internIdentityVisits = (census.internIdentityVisits ?? 0) + 1
    if (identityEntry === undefined) census.internUniqueIdentities = (census.internUniqueIdentities ?? 0) + 1
    else {
      census.internRepeatedIdentities = (census.internRepeatedIdentities ?? 0) + 1
      if (internReuseDepth === 0) {
        census.internReusableTopLevelBranches = (census.internReusableTopLevelBranches ?? 0) + 1
        census.internElidableRecursiveCalls = (census.internElidableRecursiveCalls ?? 0) + identityEntry.calls
        census.internElidablePropertyVisits = (census.internElidablePropertyVisits ?? 0) + identityEntry.properties
        census.internElidableObjectVisits = (census.internElidableObjectVisits ?? 0) + identityEntry.objects
      }
      internReuseDepth++
    }
  }
${objectEntry}`)
    const snapshotReturn = "  return { key }"
    if (source.split(snapshotReturn).length - 1 !== 1) throw new Error("Expected one memo snapshot return")
    source = source.replace(snapshotReturn, `
  if (snapshotOwner === "intern") {
    if (identityEntry !== undefined) {
      if (identityEntry.key !== key) throw new Error("Repeated native intern source identity changed within one checker invocation")
      census.internRepeatedKeysExact = (census.internRepeatedKeysExact ?? 0) + 1
      internReuseDepth--
    } else internIdentityCache.set(value, { key, calls: (census.snapshotCalls ?? 0) - identityStartCalls + 1,
      properties: (census.snapshotProperties ?? 0) - identityStartProperties,
      objects: (census.snapshotObjects ?? 0) - identityStartObjects })
  }
${snapshotReturn}`)
    source = `let internIdentityCache = new WeakMap<object, { key: string; calls: number; properties: number; objects: number }>()
let internReuseDepth = 0
export function resetInternIdentityCensus(): void {
  if (internReuseDepth !== 0) throw new Error("Intern identity census left an open branch")
  internIdentityCache = new WeakMap()
  internReuseDepth = 0
}
` + source
  }
  return "export const census: Record<string, number> = Object.create(null)\n" + (kind === "memo" ? "let snapshotOwner = \"unassigned\"\n" : "") + source
}
