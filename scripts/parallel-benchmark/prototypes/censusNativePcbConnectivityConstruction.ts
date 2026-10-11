import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

type Capture = { number: number; circuitJson: AnyCircuitElement[]; options: Record<string, unknown>; expected: unknown }
type SourceKind = "checker" | "index" | "via" | "planner" | "trace" | "polygon" | "memo" | "guard" | "lazy" | "snapshots" | "scope" | "networks" | "directed"
type Memo = { diagnostics: unknown; identities: Map<unknown, unknown>; values: Map<unknown, unknown>; nextIdentity: number }
type PolygonMemo = { diagnostics: unknown; retainedEdges: number; rows: Map<number, { edges: number; polygon?: unknown }> }
type EvidenceModule = { census: Record<string, number>; latestPrivateMemo: Memo; latestPhysicalMap: { connMap: unknown; traceIdToElm: Map<string, unknown> }; getPolygonMemo(memo: Memo): PolygonMemo | undefined; createPrivatelyMemoizedTraceContinuityChecker(): (input: AnyCircuitElement[]) => unknown; configurePreparedPrivatelyMemoizedTraceContinuityChecker(checker: unknown, executor: unknown): boolean }
const sourceRoot = process.env.REFERENCE_PROFILE_ROOT, expectedRevision = process.env.REFERENCE_PROFILE_SHA
const controlRoot = process.env.REFERENCE_CONTROL_ROOT
if (!controlRoot) throw new Error("REFERENCE_CONTROL_ROOT must identify the literal Native baseline")
const expectedControlRevision = process.env.REFERENCE_CONTROL_SHA ?? "da7e84745f2d024a390783c5dca718d6528429be"
const controlGit = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: controlRoot, stdout: "pipe", stderr: "pipe" })
assert.equal(controlGit.exitCode, 0)
assert.equal(new TextDecoder().decode(controlGit.stdout).trim(), expectedControlRevision)
if (!sourceRoot || !expectedRevision) throw new Error("REFERENCE_PROFILE_ROOT/SHA must identify immutable source")
const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: sourceRoot, stdout: "pipe", stderr: "pipe" })
assert.equal(git.exitCode, 0)
assert.equal(new TextDecoder().decode(git.stdout).trim(), expectedRevision)
const directory = resolve(process.env.REFERENCE_CENSUS_OUTPUT ?? "/tmp/native-pcb-connectivity-construction")
await mkdir(directory, { recursive: true })
const parallel = join(sourceRoot, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel"), fork = join(parallel, "authoritative-drc-fork")
const sources: Record<SourceKind, string> = {
  checker: join(fork, "native/lib/check-traces-are-contiguous/check-traces-are-contiguous.ts"),
  index: join(fork, "native/lib/util/create-indexed-pcb-connectivity-map.ts"),
  via: join(fork, "native/lib/util/get-via-and-pour-connections.ts"),
  planner: join(fork, "referenceDrcPrimitiveMissPlanning.ts"),
  trace: join(fork, "prepareReferenceDrcTracePairFacts.ts"), polygon: join(fork, "prepareReferenceDrcPolygonFacts.ts"),
  scope: join(fork, "referenceDrcNativeInternScope.ts"),
  networks: join(fork, "findOrderedIndexedConnectedNetworks.ts"),
  directed: join(fork, "findPrivatelyScopedOrderedConnectedNetworks.ts"),
  memo: join(fork, "ReferenceDrcPrimitiveMemo.ts"), guard: join(fork, "canUseExpectedPortsMemo.ts"),
  lazy: join(fork, "canUseLazyViaTraceCenters.ts"), snapshots: join(fork, "referenceDrcPolygonFacts.ts"),
}
const hashes: Record<string, string> = {}
for (const path of Object.values(sources)) hashes[relative(sourceRoot, path)] = createHash("sha256").update(new Uint8Array(await readFile(path))).digest("hex")
const nativeDirectory = await mkdtemp(join(tmpdir(), "reference-census-native-"))
const censusDirectory = await mkdtemp(join(tmpdir(), "reference-census-counted-"))
await symlink(join(sourceRoot, "node_modules"), join(nativeDirectory, "node_modules"))
await symlink(join(sourceRoot, "node_modules"), join(censusDirectory, "node_modules"))
const controlSources = Object.fromEntries(Object.entries(sources).map(([name, path]) => [name, join(controlRoot, relative(sourceRoot, path))])) as Record<SourceKind, string>
const controlPaths = await writeEvidenceSources(controlSources, nativeDirectory, false)
const censusPaths = await writeEvidenceSources(sources, censusDirectory, true)
const { initializeReferenceDrcRuntime } = await import(join(controlRoot, "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime.ts"))
await initializeReferenceDrcRuntime()
const nativeModule = await import(controlPaths.checker) as EvidenceModule
const nativeIndex = await import(controlPaths.index) as EvidenceModule
const nativeNetworks = await import(controlPaths.networks) as EvidenceModule
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
const productionSelectorSource = (await readFile(sources.index, "utf8")).includes("findPrivatelyScopedOrderedConnectedNetworks")
let previous: Record<string, number> = {}
const connectionRows: string[][][] = []
try {
  for (const capture of captures.records) {
    const nativeInput = structuredClone(capture.circuitJson), candidateInput = structuredClone(capture.circuitJson)
    const options = { ...capture.options, viaTraceChecker: (input: AnyCircuitElement[], options: object): ReturnType<typeof checkViaTraceClearanceWithLazyCenters> => checkViaTraceClearanceWithLazyCenters(input, { ...options, enableAxisRejection: true, enableConnectivityMemo: true }) }
    const before = pool.getNativeReferenceFactStats()!
    const expected = getDrcErrors(nativeInput, { ...options, traceContinuityChecker: native })
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
    const orderedConnections = (counted.directed as unknown as { latestConnections: string[][] }).latestConnections
    if (orderedConnections !== undefined) connectionRows.push(orderedConnections.map((row) => [...row]))
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
    kind: "Native physical PCB graph construction operation census, production selector oracle and independent directed-union proof",
    sourceRevision: expectedRevision, sourceRoot, controlRevision: expectedControlRevision, controlRoot, bunVersion: Bun.version,
    scriptSha256: createHash("sha256").update(new Uint8Array(await readFile(import.meta.path))).digest("hex"),
    captureSha256: createHash("sha256").update(captureBytes).digest("hex"), sourceHashes: hashes,
    whole17NativeErrorsExact: true, postCircuitJsonExact: true, errorSourceAliasPathsExact: true,
    primitiveMemoValuesIdsFifoCountersExact: true, scaledPolygonRowsDiagnosticsRetainedEdgesExact: true,
    physicalNetIdsAndOriginalTraceAliasesExact: true, originalWarmPrivateMemoRetained: true,
    nativeMethodsWrapped: false, callbackCountersInstalled: false,
    admissionBypassed: false, genuineDefaultPoolExecutor: true,
    limitation: "Only source-local closed numeric counters and readonly evidence exports are added in isolated copies. The profiler uses untouched production instead. Counts are actual main Native loop/body visits; native geometry dependencies and worker calculations are not instrumented. Counts do not imply elapsed-time or speed improvement.",
    noLocalElapsedComparison: true, noSpeedClaim: true, totals: previous, factStats: stats, records,
    isolatedSelectorActivation: !productionSelectorSource, productionSelectorSourcePresent: productionSelectorSource, literalNetworkTotals: nativeNetworks.census,
    orderedUnionProof: proveOrderedUnion(connectionRows),
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
  const kinds: SourceKind[] = counted ? Object.keys(sources) as SourceKind[] : ["checker", "index", "via", "planner", "trace", "polygon", "networks"]
  const paths = Object.fromEntries(kinds.map((kind) => [kind, join(directory, `${kind}.ts`)])) as Record<SourceKind, string>
  for (const kind of kinds) {
    let source = await readFile(sources[kind], "utf8")
    if (counted || kind === "networks") source = insertCounters(kind, source)
    if (kind === "index" && counted && !source.includes("findPrivatelyScopedOrderedConnectedNetworks")) source = 'import { findPrivatelyScopedOrderedConnectedNetworks } from "../../../findPrivatelyScopedOrderedConnectedNetworks"\n' + source.replace("? findOrderedIndexedConnectedNetworks(connections)", "? findPrivatelyScopedOrderedConnectedNetworks(primitiveMemo, connections) ?? findOrderedIndexedConnectedNetworks(connections)")
    if (kind === "checker") source = "export let latestPrivateMemo: unknown\nexport function getPolygonMemo(memo: any): any { return privatelyOwnedPolygonMemos.get(memo) }\n" + source.replaceAll("const primitiveMemo = new ReferenceDrcPrimitiveMemo()", "const primitiveMemo = new ReferenceDrcPrimitiveMemo()\n  latestPrivateMemo = primitiveMemo")
    if (kind === "directed") source = "export let latestConnections: string[][] | undefined\n" + source.replace("  const active = new Map<string, Network>()", "  latestConnections = connections\n  const active = new Map<string, Network>()")
    if (kind === "networks") source = "export let latestConnections: string[][] | undefined\n" + source.replace("  const networks = new Map<string, Set<string>>()", "  latestConnections = connections\n  const networks = new Map<string, Set<string>>()")
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
    directed: [
      ["  const find = (entry: Network): Network => {", "rootFinds"],
      ["    while (root.parent !== undefined) root = root.parent", "rootFindLoops"],
      ["      const next = entry.parent", "parentCompressions"],
      ["    const network: Network = {", "networksCreated"],
      ["          if (other !== network) {", "directedMerges"],
      ["        const member: Member = { value: nodeId, next: undefined }", "memberAllocations"],
      ["    for (let member = network.head; member !== undefined; member = member.next) members.push(member.value)", "outputRows"],
    ],
    networks: [
      ["  for (const connection of connections) {", "connectionRows"],
      ["    for (const nodeId of connection) {", "connectionIds"],
      ["    const existing = networkByNode.get(nodeId)", "networkLookupCalls"],
      ["    const network = new Set<string>()", "networksCreated"],
      ["          for (const member of other) {", "directedMergeMemberVisits"],
      ["          networks.delete(nameByNetwork.get(other)!)", "directedMerges"],
      ["      networkByNode.set(nodeId, network)", "originalMembershipAssignments"],
    ],
    scope: [
      ["  if (!isPrivatelyOwnedReferenceDrcPrimitiveMemo(memo)) return undefined", "scopeAttempts"],
      ["  defineProperty(memo, \"intern\", { value: scopedIntern, configurable: true, writable: true, enumerable: false })", "scopeAdmissions"],
      ["  const scopedIntern = (value: unknown): number => {", "internCalls"],
      ["function internSnapshotKey(value: unknown, visiting: Set<object>, completed: CompletedSubkeys): Snapshot {", "snapshotCalls"],
      ["  if (previous !== undefined) return { key: previous }", "cacheChecks"],
      ["  const prototype = Object.getPrototypeOf(value)", "snapshotObjects"],
      ["    const descriptor = Object.getOwnPropertyDescriptor(value, property)!", "snapshotProperties"],
      ["    completed.entries++", "completedEntries"],
      ["      applyNative(activeDelete, activeMemos, [memo])", "scopeFinishes"],
    ],
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
      ["        for (const connectedTrace of pcbConnectivityMap!.getAllTracesConnectedToTrace(\n          traceId,\n        )) {", "physicalComponentMembers"],
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
    if (kind === "directed" && counter === "rootFindLoops") { source = source.replace(anchor, "while (root.parent !== undefined) { census.parentHops = (census.parentHops ?? 0) + 1; root = root.parent }"); continue }
    if (kind === "scope" && counter === "cacheChecks") { source = source.replace(anchor, "if (previous !== undefined) { census.cacheHits = (census.cacheHits ?? 0) + 1; return { key: previous } }"); continue }
    source = source.replace(anchor, (anchor.trimEnd().endsWith("{") && !anchor.includes("const network: Network")) || anchor.trimEnd().endsWith(")") || anchor.includes("return undefined") ? `${anchor}\n${increment}` : `${increment}\n${anchor}`)
  }
  if (kind === "scope") source = source.replace("      applyNative(activeDelete, activeMemos, [memo])", "      census.maximumSidecarEntries = Math.max(census.maximumSidecarEntries ?? 0, completed.entries)\n      census.maximumSidecarCharacters = Math.max(census.maximumSidecarCharacters ?? 0, completed.characters)\n      applyNative(activeDelete, activeMemos, [memo])")
  return "export const census: Record<string, number> = Object.create(null)\n" + (kind === "memo" ? "let snapshotOwner = \"unassigned\"\n" : "") + source
}

type OrderedMember = { value: string; next: OrderedMember | undefined }
type DirectedNetwork = { parent: DirectedNetwork; name: string; head: OrderedMember | undefined; tail: OrderedMember | undefined }
type OrderedUnionCounters = { ids: number; finds: number; parentHops: number; compressions: number; merges: number; created: number; memberAllocations: number; outputMembers: number }

/** Independent pure string-domain oracle; this routine does not mutate source. */
function prototypeOrderedUnion(connections: string[][]): { result: Record<string, string[]>; counts: OrderedUnionCounters } {
  const active = new Map<string, DirectedNetwork>(), membership = new Map<string, DirectedNetwork>()
  const counts: OrderedUnionCounters = { ids: 0, finds: 0, parentHops: 0, compressions: 0, merges: 0, created: 0, memberAllocations: 0, outputMembers: 0 }
  const find = (entry: DirectedNetwork): DirectedNetwork => {
    counts.finds++
    let root = entry
    while (root.parent !== root) { counts.parentHops++; root = root.parent }
    while (entry.parent !== entry) { const next = entry.parent; entry.parent = root; counts.compressions++; entry = next }
    return root
  }
  const getOrCreate = (id: string): DirectedNetwork => {
    const existing = membership.get(id)
    if (existing !== undefined) return find(existing)
    const node = { parent: undefined as unknown as DirectedNetwork, name: `connectivity_net${counts.created++}`, head: undefined, tail: undefined } as DirectedNetwork
    node.parent = node; active.set(node.name, node)
    return node
  }
  for (const connection of connections) {
    let current: DirectedNetwork | undefined
    for (const id of connection) {
      counts.ids++
      if (current === undefined) current = getOrCreate(id)
      else {
        const assigned = membership.get(id)
        if (assigned === undefined || find(assigned) !== current) {
          const other = getOrCreate(id)
          if (other !== current) {
            counts.merges++
            if (other.head !== undefined) {
              if (current.tail !== undefined) current.tail.next = other.head
              else current.head = other.head
              current.tail = other.tail
            }
            other.parent = current; active.delete(other.name)
          }
        }
      }
      const assigned = membership.get(id)
      if (assigned === undefined) {
        const member: OrderedMember = { value: id, next: undefined }
        if (current.tail === undefined) current.head = member
        else current.tail.next = member
        current.tail = member; membership.set(id, current); counts.memberAllocations++
      }
    }
  }
  const rows: [string, string[]][] = []
  for (const [name, network] of active) {
    const members: string[] = []
    for (let entry = network.head; entry !== undefined; entry = entry.next) { members.push(entry.value); counts.outputMembers++ }
    rows.push([name, members])
  }
  return { result: Object.fromEntries(rows), counts }
}

function literalOrderedUnion(connections: string[][]): Record<string, string[]> {
  const networks = new Map<string, Set<string>>()
  let nextNetwork = 0
  const getOrCreate = (id: string): Set<string> => {
    for (const [, members] of networks) if (members.has(id)) return members
    const network = new Set<string>(); networks.set(`connectivity_net${nextNetwork++}`, network)
    return network
  }
  for (const row of connections) {
    let current: Set<string> | undefined
    for (const id of row) {
      if (current === undefined) current = getOrCreate(id)
      else if (!current.has(id)) {
        const other = getOrCreate(id)
        if (other !== current) {
          for (const member of other) current.add(member)
          networks.delete([...networks].find(([, members]) => members === other)![0])
        }
      }
      current.add(id)
    }
  }
  return Object.fromEntries([...networks].map(([id, members]) => [id, [...members]]))
}

function proveOrderedUnion(actual: string[][][]): unknown {
  const totals: OrderedUnionCounters = { ids: 0, finds: 0, parentHops: 0, compressions: 0, merges: 0, created: 0, memberAllocations: 0, outputMembers: 0 }
  const rows: unknown[] = []
  for (const [index, connections] of actual.entries()) {
    for (const row of connections) for (const id of row) assert.equal(typeof id, "string")
    const prototype = prototypeOrderedUnion(connections)
    const literal = literalOrderedUnion(connections)
    assert.deepStrictEqual(prototype.result, literal)
    assert.deepStrictEqual(new ConnectivityMap(prototype.result), new ConnectivityMap(literal))
    for (const key of Object.keys(totals) as (keyof OrderedUnionCounters)[]) totals[key] += prototype.counts[key]
    rows.push({ index, connections: connections.length, outputNetworks: Object.keys(prototype.result).length, counts: prototype.counts, resultSha256: createHash("sha256").update(JSON.stringify(prototype.result)).digest("hex") })
  }
  let state = 7
  const random = (): number => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state }
  const edge: string[][][] = [[], [[]], [["a"]], [["a", "a"]], [["0", "a"], ["b", "a"]], [["__proto__", "constructor"], ["constructor", "toString"]], [["a", "b"], ["c", "d"], ["e", "a", "c"], ["b", "f"]], [["", "0", "01", "4294967294", "4294967295"], ["__defineGetter__", "hasOwnProperty", "valueOf", "prototype", "length"]]]
  for (let fixture = 0; fixture < 5000; fixture++) {
    const connections: string[][] = []
    for (let i = 0, count = random() % 70; i < count; i++) {
      const row: string[] = []
      for (let j = 0, width = random() % 6; j < width; j++) row.push(String(random() % 23))
      connections.push(row)
    }
    edge.push(connections)
  }
  for (const connections of edge) {
    const candidate = prototypeOrderedUnion(connections).result, literal = literalOrderedUnion(connections)
    assert.deepStrictEqual(candidate, literal)
    const candidateGraph = new ConnectivityMap(candidate), nativeGraph = new ConnectivityMap(literal)
    assert.deepStrictEqual(candidateGraph, nativeGraph)
    assert.deepStrictEqual(Object.keys(candidateGraph.idToNetMap), Object.keys(nativeGraph.idToNetMap))
    assert.deepStrictEqual(Object.getOwnPropertyDescriptors(candidateGraph.idToNetMap), Object.getOwnPropertyDescriptors(nativeGraph.idToNetMap))
    assert.equal(Object.getPrototypeOf(candidateGraph.idToNetMap), Object.getPrototypeOf(nativeGraph.idToNetMap))
    assert.equal(candidateGraph.netMap, candidate)
    for (const members of Object.values(candidate)) {
      assert(!connections.some((row) => row === members))
      for (const other of Object.values(candidate)) if (other !== members) assert(other !== members)
    }
  }
  return { isolatedOnly: true, mutatesProductionAlgorithm: false, actualGraphs: actual.length, actualGraphsExact: true, randomizedAndEdgeFixtures: edge.length, stringDomainOnly: true, originalNetworkNamesCreationDeletionAndMemberOrderExact: true, originalPlainObjectKeyEnumerationDescriptorsPrototypesExact: true, nativeConstructorRetainsOutputNetMapAlias: true, freshOutputArraysRetainNativeAliasShape: true, outputMembersOriginalStringIdentities: true, originalGraphConstructorNotReplaced: true, totals, records: rows }
}
