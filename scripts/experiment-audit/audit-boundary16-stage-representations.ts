import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { decodeCaptureData, extractRouteBundle } from "./audit-retention-stage-geometry"

type Data = Record<string, unknown>
type Point = { x: number; y: number }
type ViaSite = Point & { diameter: number; minZ: number; maxZ: number; routeName: string }
type HdPoint = Point & { z: number; toNextSegmentType?: string }
type HdRoute = { connectionName: string; traceThickness: number; viaDiameter: number; route: HdPoint[]; vias: Point[] }
type Bundle = { routes: unknown[]; format: "hd" | "traces"; field: string; coordinateFrame: "world-mm" }
type Geometry = { viaSpans: Array<{ center: Point; diameter: number; minZ: number; maxZ: number }> }
type Placement = Point & { viaDiameter: number; zStart: number; zEnd: number }
type GeometryFunction = (route: HdRoute, board: { layerCount: number; allowBlindAndBuriedVias?: boolean }) => Geometry
type SourceApi = {
  geometry: GeometryFunction
  boardValidator: (geometry: Data) => (placement: Placement) => boolean
  viaValidator: (context: Data) => (placement: Placement, name: string) => boolean
  canonicalize: (routes: HdRoute[]) => HdRoute[]
  convertP7: (params: Data) => Data[]
  uniqueIds: (traces: Data[], original: unknown[]) => Data[]
  circuit: (srj: Data, traces: Data[], options: Data) => Data[]
  boardElement: (geometry: Data) => Data
  connMap: new (netMap: Record<string, string[]>) => { netMap: Record<string, string[]>; idToNetMap: Record<string, string> }
  checkVias: (circuit: Data[]) => Data[]
  checkCopper: (circuit: Data[]) => Data[]
}
type Snapshot = { phase: string; boundary: string; value: unknown; sequence: number; recordSha256: string }
type PrivateReport = { public: Data; sites: Record<string, ViaSite[]>; converted?: Data[] }
const SOURCE = "bd21dd642b4989b00e8279fae5c60cc7276ad642"
const TREE = "a336ba7ec687e7813d97284faafd294a94e329eb"
const INPUT = "1da76797d2a979c051bce8bc9fbb33c76fcd036cb2353a19905bf6b56775c5b9"
const OUTPUT = "e88f5894d031cc74b25f5c10af07dca8224179f04758455e10b1397f111c3a90"
const TRACES = "89e591711022d6751f78c5f0394ee0bed8cb913b5235d02baaaaa2f128145516"
const PHASES = ["highDensityRouteSolver", "highDensityForceImproveSolver", "highDensityRepairSolver", "highDensityStitchSolver", "traceSimplificationSolver", "mutatedPreloadedTraceSimplificationSolver", "traceWidthSolver", "globalDrcForceImproveSolver", "pipeline9JointDrcRepairSolver", "effortCleanupSolver", "lengthMatchingPostProcessingSolver", "powerTraceExpansionSolver"]

function hash(value: string): string {
  const digest = createHash("sha256")
  digest.update(value)
  const encoded = digest.digest("hex")
  assert.equal(encoded.length, 64)
  return encoded
}

function object(value: unknown): Data {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "Expected captured own-data object")
  assert(!(value instanceof Map) && !(value instanceof Set), "Expected plain object rather than typed container")
  const result = value as Data
  assert(Object.getPrototypeOf(result) === null || Object.getPrototypeOf(result) === Object.prototype, "Unexpected executable object")
  return result
}

function array(value: unknown): unknown[] {
  assert(Array.isArray(value), "Expected captured array")
  const result: unknown[] = value
  for (const item of result) assert(item !== undefined, "Missing array item")
  assert(Number.isSafeInteger(result.length), "Invalid array length")
  return result
}

function finite(value: unknown): number {
  assert(typeof value === "number", "Expected numeric geometry")
  assert(Number.isFinite(value), "Expected finite geometry")
  const result = value
  assert(!Number.isNaN(result), "NaN geometry")
  return result
}

function hdRoute(value: unknown, layers: number): HdRoute {
  const route = object(value)
  assert(typeof route.connectionName === "string", "Missing actual route name")
  assert(finite(route.viaDiameter) > 0 && finite(route.traceThickness) > 0, "Invalid physical route dimensions")
  for (const item of array(route.route)) {
    const point = object(item)
    finite(point.x); finite(point.y)
    assert(Number.isSafeInteger(point.z) && Number(point.z) >= 0 && Number(point.z) < layers, "Invalid original layer")
  }
  for (const item of array(route.vias)) { const point = object(item); finite(point.x); finite(point.y) }
  return route as unknown as HdRoute
}

function siteHash(site: ViaSite, centerOnly = false): string {
  const coordinates = [site.x, site.y]
  const identity = centerOnly ? coordinates : [...coordinates, site.diameter]
  const text = JSON.stringify(identity)
  assert(typeof text === "string")
  return hash(text)
}

function summarizeSites(sites: ViaSite[], board: (placement: Placement) => boolean, guard?: (placement: Placement, name: string) => boolean): Data {
  const diameterCounts: Record<string, number> = {}, spanCounts: Record<string, number> = {}
  const rejected: string[] = [], guardRejected: string[] = []
  for (const site of sites) {
    diameterCounts[String(site.diameter)] = (diameterCounts[String(site.diameter)] ?? 0) + 1
    spanCounts[`${site.minZ}:${site.maxZ}`] = (spanCounts[`${site.minZ}:${site.maxZ}`] ?? 0) + 1
    const placement = { x: site.x, y: site.y, viaDiameter: site.diameter, zStart: site.minZ, zEnd: site.maxZ }
    if (!board(placement)) rejected.push(siteHash(site))
    if (guard && !guard(placement, site.routeName)) guardRejected.push(siteHash(site))
  }
  return { count: sites.length, uniqueFootprints: new Set(sites.map(site => siteHash(site))).size, diameterCounts, rawSpanCounts: spanCounts, boardRejectedCount: rejected.length, boardRejectedFootprintHashes: [...new Set(rejected)], originalCallbackRejectedCount: guard ? guardRejected.length : null }
}

/** Pure channel audit. Coordinates remain private; returned summaries contain hashes only. */
export function inspectBoundaryBundle(bundle: Bundle, layers: number, diameter: number, geometry: GeometryFunction, board: (placement: Placement) => boolean, guard?: (placement: Placement, name: string) => boolean): PrivateReport {
  const sites: Record<string, ViaSite[]> = { declared: [], sourceGuardGeometry: [], physicalDiameterTransitionCandidates: [], routeDiameterTransitionCandidates: [], traceVias: [] }
  let throughObstacleTransitions = 0, throughWithoutExplicitVia = 0, nonColocatedTransitions = 0
  if (bundle.format === "hd") for (const item of bundle.routes) {
    const route = hdRoute(item, layers)
    for (const via of route.vias) sites.declared!.push({ ...via, diameter: route.viaDiameter, minZ: 0, maxZ: layers - 1, routeName: route.connectionName })
    // Every source call receives a fresh identity, excluding historical cache state.
    for (const via of geometry(structuredClone(route), { layerCount: layers }).viaSpans) {
      assert(finite(via.diameter) > 0, "Invalid source guard radius")
      sites.sourceGuardGeometry!.push({ x: finite(via.center.x), y: finite(via.center.y), diameter: via.diameter, minZ: via.minZ, maxZ: via.maxZ, routeName: route.connectionName })
    }
    for (let i = 1; i < route.route.length; i++) {
      const a = route.route[i - 1]!, b = route.route[i]!
      if (a.z === b.z) continue
      const colocated = Math.hypot(a.x - b.x, a.y - b.y) <= 1e-6
      const explicit = route.vias.some(via => Math.hypot(via.x - b.x, via.y - b.y) <= 1e-9)
      if (a.toNextSegmentType === "through_obstacle") { throughObstacleTransitions++; throughWithoutExplicitVia += Number(!explicit) }
      if (!colocated) { nonColocatedTransitions++; continue }
      sites.physicalDiameterTransitionCandidates!.push({ x: b.x, y: b.y, diameter, minZ: 0, maxZ: layers - 1, routeName: route.connectionName })
      sites.routeDiameterTransitionCandidates!.push({ x: b.x, y: b.y, diameter: route.viaDiameter, minZ: 0, maxZ: layers - 1, routeName: route.connectionName })
    }
  } else for (const item of bundle.routes) {
    const trace = object(item)
    const name = typeof trace.connection_name === "string" ? trace.connection_name : ""
    for (const value of array(trace.route)) {
      const point = object(value)
      if (point.route_type !== "via") continue
      sites.traceVias!.push({ x: finite(point.x), y: finite(point.y), diameter: point.via_diameter === undefined ? diameter : finite(point.via_diameter), minZ: 0, maxZ: layers - 1, routeName: name })
    }
  }
  const channels = Object.fromEntries(Object.entries(sites).map(([name, values]) => [name, summarizeSites(values, board, guard)]))
  return { public: { format: bundle.format, authoritativeField: bundle.field, coordinateFrame: bundle.coordinateFrame, routeCount: bundle.routes.length, throughObstacleTransitions, throughWithoutExplicitVia, throughExplicitViaCoincidenceMm: 1e-9, nonColocatedTransitions, channels, transitionCandidateLimit: "Original-physical-diameter and route-diameter transition candidates are separate representation diagnostics, not proof that a new via was manufactured." }, sites }
}

export async function loadBoundarySourceApi(root: string): Promise<SourceApi> {
  assert.equal(execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim(), TREE, "Unexpected algorithm tree")
  const load = async (path: string): Promise<Data> => await import(pathToFileURL(resolve(root, path)).href) as Data
  const required = createRequire(resolve(root, "package.json"))
  const [geometry, board, guard, canonical, converter, ids, circuit, connectivity, checks] = await Promise.all([
    load("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper.ts"),
    load("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaBoardPlacementValidator.ts"),
    load("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator.ts"),
    load("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes.ts"),
    load("lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces.ts"),
    load("lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces.ts"),
    load("lib/testing/utils/convertToCircuitJson.ts"),
    import(pathToFileURL(required.resolve("circuit-json-to-connectivity-map")).href) as Promise<Data>,
    import(pathToFileURL(required.resolve("@tscircuit/checks")).href) as Promise<Data>,
  ])
  return { geometry: geometry.getPipeline9RouteCopperGeometry, boardValidator: board.getPipeline9ViaBoardPlacementValidator, viaValidator: guard.getPipeline9ViaPlacementValidator, canonicalize: canonical.canonicalizePipeline9HdRoutes, convertP7: converter.convertPipeline7HdRoutesToSimplifiedPcbTraces, uniqueIds: ids.assignUniquePcbTraceIdsToNewTraces, circuit: circuit.convertToCircuitJson, boardElement: circuit.createPcbBoardElement, connMap: connectivity.ConnectivityMap, checkVias: checks.checkViasOffBoard, checkCopper: checks.checkCopperToBoardEdgeClearance } as SourceApi
}

function loadCapture(directory: string): { manifest: Data; snapshots: Snapshot[]; orderComplete: boolean; captureComplete: boolean } {
  const root = resolve(directory), manifest = object(JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")))
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.algorithmSha, SOURCE); assert.equal(manifest.dataset, "srj18"); assert.equal(manifest.originalSample, 16); assert.equal(manifest.inputSha256, INPUT)
  assert.equal(manifest.diagnosticOnly, true); assert.equal(manifest.timingQualified, false)
  if (process.env.GITHUB_SHA) assert.equal(manifest.controllerSha, process.env.GITHUB_SHA)
  if (process.env.GITHUB_RUN_ID) assert.equal(String(manifest.githubRunId), process.env.GITHUB_RUN_ID)
  assert.equal(manifest.sourceSha256, hash(readFileSync(new URL("./stage-geometry-capture.ts", import.meta.url), "utf8")), "Capture source changed")
  const expected = ["original_input:pipeline", ...PHASES.flatMap(phase => phase === "highDensityRouteSolver" ? [`constructor_params_return:${phase}`, `pipeline_context:${phase}`, `completed_phase:${phase}`] : [`constructor_params_return:${phase}`, `completed_phase:${phase}`]), "final_output:pipeline"]
  const snapshots: Snapshot[] = [], keys: string[] = []
  for (const [index, value] of array(manifest.records).entries()) {
    const record = object(value)
    assert.equal(record.sequence, index); assert(typeof record.file === "string"); assert.equal(basename(record.file), record.file)
    const path = resolve(root, record.file); assert(path.startsWith(root + sep))
    const text = readFileSync(path, "utf8"); assert.equal(Buffer.byteLength(text), record.bytes); assert.equal(hash(text), record.sha256)
    const snapshot = object(JSON.parse(text)), metadata = object(snapshot.metadata)
    assert.equal(snapshot.schemaVersion, 1); assert.equal(snapshot.diagnosticOnly, true); assert.equal(snapshot.timingQualified, false); assert.equal(snapshot.sourceSha256, manifest.sourceSha256)
    for (const key of ["algorithmSha", "controllerSha", "githubRunId", "arm", "dataset", "originalSample", "inputSha256", "campaign", "executionOrder"]) assert.deepEqual(metadata[key], manifest[key], "Snapshot binding changed")
    assert.equal(snapshot.phase, record.phase); assert.equal(snapshot.boundary, record.boundary)
    assert(typeof snapshot.phase === "string" && typeof snapshot.boundary === "string" && typeof record.sha256 === "string")
    keys.push(`${snapshot.boundary}:${snapshot.phase}`)
    snapshots.push({ phase: snapshot.phase, boundary: snapshot.boundary, value: decodeCaptureData(snapshot.value), sequence: index, recordSha256: record.sha256 })
  }
  assert.equal(new Set(keys).size, keys.length, "Duplicate captured boundary")
  const orderComplete = JSON.stringify(keys) === JSON.stringify(expected)
  return { manifest, snapshots, orderComplete, captureComplete: orderComplete && array(manifest.errors).length === 0 }
}

export function restoreBoundaryConversion(snapshots: Snapshot[], original: Data, api: SourceApi): { convert: (routes: HdRoute[]) => Data[]; proof: Data } {
  const contexts = snapshots.filter(s => s.boundary === "pipeline_context")
  assert.equal(contexts.length, 1, "Missing exact pipeline context")
  const context = object(contexts[0]!.value), captured = object(context.connMap), netMap = object(captured.netMap)
  for (const members of Object.values(netMap)) assert(array(members).every(member => typeof member === "string"), "Invalid connectivity member")
  const restored = new api.connMap(netMap as Record<string, string[]>)
  assert.deepEqual(JSON.parse(JSON.stringify(restored.netMap)), JSON.parse(JSON.stringify(netMap)), "Connectivity netMap restoration differs")
  assert.deepEqual(JSON.parse(JSON.stringify(restored.idToNetMap)), JSON.parse(JSON.stringify(captured.idToNetMap)), "Connectivity id map restoration differs")
  const pointPairs = object(context.srjWithPointPairs), connections = array(pointPairs.connections)
  const hdInput = snapshots.find(s => s.phase === "highDensityRouteSolver" && s.boundary === "constructor_params_return")
  assert(hdInput); const params = object(array(hdInput.value)[0]); const obstacles = array(params.obstacles)
  const layerCount = finite(original.layerCount), hole = finite(params.viaHoleDiameter)
  assert.equal(params.layerCount, layerCount); assert(!original.traces || array(original.traces).length === 0, "Preloaded conversion is outside this diagnostic contract")
  const counts = new Map<string, number>()
  for (const item of connections) { const c = object(item); assert(typeof c.name === "string"); counts.set(c.name, (counts.get(c.name) ?? 0) + 1) }
  const convert = (routes: HdRoute[]): Data[] => {
    for (const route of routes) assert.equal(counts.get(route.connectionName), 1, "Uncovered or ambiguous HD connection in P7 conversion")
    const traces = api.convertP7({ connections, originalConnections: original.connections, hdRoutes: api.canonicalize(structuredClone(routes)), layerCount, obstacles, defaultViaHoleDiameter: hole, connMap: restored })
    assert.equal(traces.length, routes.length, "P7 route coverage changed")
    return api.uniqueIds(traces, [])
  }
  return { convert, proof: { status: "TYPED_CONNECTIVITY_ROUNDTRIP_PASSED_PENDING_END_TO_END_BINDING", connectionCount: connections.length, originalPreloadedTraceCount: 0, terminalViaPointCount: connections.reduce<number>((n, value) => n + array(object(value).pointsToConnect).filter(point => object(point).terminalVia !== undefined).length, 0) } }
}

function materializedSites(original: Data, traces: Data[], api: SourceApi): { sites: ViaSite[]; checks: Data } {
  const circuit = api.circuit(original, traces, { originalSrj: original, includeOriginalConnections: true, minTraceWidth: original.minTraceWidth, minViaDiameter: original.minViaDiameter })
  const board = api.boardElement({ ...original, minBoardEdgeClearance: original.minBoardEdgeClearance ?? 0 })
  const sites = circuit.filter(item => item.type === "pcb_via").map(item => ({ x: finite(item.x), y: finite(item.y), diameter: finite(item.outer_diameter), minZ: 0, maxZ: Number(original.layerCount) - 1, routeName: "" }))
  const evaluated = [...circuit, board]
  return { sites, checks: { materializedViaCount: sites.length, pinnedViaBoardFindingCount: api.checkVias(evaluated).length, pinnedBoardCopperFindingCount: api.checkCopper(evaluated).length } }
}

/** Missing earlier authoritative outputs always prevent a first-producer claim. */
export function firstQualifiedViolation(reports: Data[], complete: boolean, conversionBound: boolean, finalBound: boolean): Data | null {
  if (!complete || !conversionBound || !finalBound) return null
  if (!reports.every(report => report.status === "COMPLETE")) return null
  const bad = reports.find(report => object(report.materializedChecks).pinnedBoardCopperFindingCount !== 0 || object(report.materializedChecks).pinnedViaBoardFindingCount !== 0)
  if (!bad) return null
  const previous = reports.filter(report => Number(report.sequence) < Number(bad.sequence))
  if (!previous.every(report => report.status === "COMPLETE" && object(report.materializedChecks).pinnedBoardCopperFindingCount === 0 && object(report.materializedChecks).pinnedViaBoardFindingCount === 0)) return null
  return { phase: bad.phase, boundary: bad.boundary, sequence: bad.sequence, interpretation: bad.boundary === "constructor_params_return" ? "First violation appears in this stage's input preparation, not necessarily its solver body." : "All preceding authoritative captured outputs and inputs were board-clear." }
}

export async function auditBoundary16StageRepresentations(directory: string, algorithmRoot: string): Promise<Data> {
  const capture = loadCapture(directory), api = await loadBoundarySourceApi(resolve(algorithmRoot))
  const input = capture.snapshots.filter(s => s.boundary === "original_input")
  assert.equal(input.length, 1); const original = object(input[0]!.value); assert.equal(hash(JSON.stringify(original)), INPUT)
  const layerCount = finite(original.layerCount)
  assert.equal(original.allowBlindAndBuriedVias === true, false, "This exact original16 diagnostic requires full-span nonblind vias")
  const board = api.boardValidator(original)
  const hdInput = capture.snapshots.find(s => s.phase === "highDensityRouteSolver" && s.boundary === "constructor_params_return")
  assert(hdInput); const params = object(array(hdInput.value)[0]), context = object(params.viaPlacementContext)
  const diameter = finite(params.viaDiameter)
  assert(diameter > 0, "Missing actual captured physical via diameter")
  assert.equal(context.layerCount, layerCount); const guard = api.viaValidator(context)
  let converter: ((routes: HdRoute[]) => Data[]) | undefined, conversionProof: Data
  try { const restored = restoreBoundaryConversion(capture.snapshots, original, api); converter = restored.convert; conversionProof = restored.proof }
  catch (error) { conversionProof = { status: "UNAVAILABLE_NO_FIRST_PRODUCER_CLAIM", reasonSha256: hash(String(error)) } }
  const reports: Data[] = [], privateReports: Array<{ snapshot: Snapshot; report: PrivateReport }> = []
  for (const snapshot of capture.snapshots) {
    if (snapshot.boundary === "original_input" || snapshot.boundary === "pipeline_context") continue
    try {
      const bundle = extractRouteBundle(snapshot, SOURCE) as Bundle | null
      if (!bundle) continue
      const inspected = inspectBoundaryBundle(bundle, layerCount, diameter, api.geometry, board, guard)
      const traces = bundle.format === "traces" ? bundle.routes.map(object) : converter ? converter(bundle.routes.map(route => hdRoute(route, layerCount))) : undefined
      if (traces) {
        const materialized = materializedSites(original, traces, api)
        inspected.sites.materialized = materialized.sites; inspected.converted = traces
        inspected.public.materializedChecks = materialized.checks
        inspected.public.materializedVias = summarizeSites(materialized.sites, board)
      }
      const report: Data = { sequence: snapshot.sequence, phase: snapshot.phase, boundary: snapshot.boundary, rawSha256: snapshot.recordSha256, status: traces ? "COMPLETE" : "INCOMPLETE_CONVERSION_UNAVAILABLE", ...inspected.public }
      reports.push(report); privateReports.push({ snapshot, report: inspected })
    } catch (error) {
      // The immutable capture remains valid; unsupported geometry is explicit.
      // Hash exception text because source errors may embed raw coordinates.
      reports.push({ sequence: snapshot.sequence, phase: snapshot.phase, boundary: snapshot.boundary, rawSha256: snapshot.recordSha256, status: "INCOMPLETE", reasonSha256: hash(String(error)) })
    }
  }
  const finals = capture.snapshots.filter(s => s.boundary === "final_output")
  assert.equal(finals.length, 1); const final = object(finals[0]!.value)
  const finalBound = hash(JSON.stringify(final.traces)) === TRACES && hash(JSON.stringify(final.output)) === OUTPUT
  const powerInput = privateReports.find(item => item.snapshot.phase === "powerTraceExpansionSolver" && item.snapshot.boundary === "constructor_params_return")
  const lastHd = [...privateReports].reverse().find(item => item.snapshot.phase === "lengthMatchingPostProcessingSolver" && item.snapshot.boundary === "completed_phase")
  const conversionBound = !!converter && !!powerInput?.report.converted && !!lastHd?.report.converted && hash(JSON.stringify(lastHd.report.converted)) === hash(JSON.stringify(powerInput.report.converted))
  conversionProof.endToEndLastHdToActualPowerInputMatched = conversionBound
  conversionProof.status = conversionBound ? "QUALIFIED_TYPED_RESTORATION_AND_ACTUAL_POWER_INPUT_PARITY" : "UNQUALIFIED_NO_FIRST_PRODUCER_CLAIM"
  const finalPrivate = privateReports.find(item => item.snapshot.boundary === "final_output")
  const finalBadSites = (finalPrivate?.report.sites.materialized ?? []).filter(site => !board({ x: site.x, y: site.y, viaDiameter: site.diameter, zStart: site.minZ, zEnd: site.maxZ }))
  const histories = finalBadSites.map(site => ({ finalFootprintSha256: siteHash(site), finalCenterSha256: siteHash(site, true), finalDiameter: site.diameter, histories: privateReports.map(item => ({ sequence: item.snapshot.sequence, phase: item.snapshot.phase, boundary: item.snapshot.boundary, channels: Object.fromEntries(Object.entries(item.report.sites).map(([channel, sites]) => [channel, { exactFootprintMatches: sites.filter(candidate => siteHash(candidate) === siteHash(site)).length, exactCenterMatches: sites.filter(candidate => siteHash(candidate, true) === siteHash(site, true)).length }])) })), interpretation: "Exact final-site appearance is not the first global violation. Earlier different sites or diameters may already violate the board." }))
  const complete = capture.captureComplete && reports.every(report => report.status === "COMPLETE") && PHASES.every(phase => reports.some(report => report.phase === phase && report.boundary === "completed_phase"))
  return { status: complete && conversionBound && finalBound ? "COMPLETE_BOUNDARY_REPRESENTATION_STAGE_AUDIT" : "INCOMPLETE_OR_UNBOUND_NO_FIRST_PRODUCER_CLAIM", diagnosticOnly: true, timingQualified: false, algorithmSha: SOURCE, algorithmTree: TREE, inputSha256: INPUT, capturedPhysicalViaDiameterMm: diameter, captureOrderComplete: capture.orderComplete, captureErrors: capture.manifest.errors, recordCount: capture.snapshots.length, sourceGeometryCachePolicy: "Fresh structuredClone route identity for every source geometry query; historical mutable caches cannot affect this offline result.", finalBinding: { matched: finalBound, tracesSha256: hash(JSON.stringify(final.traces)), outputSha256: hash(JSON.stringify(final.output)), expectedTracesSha256: TRACES, expectedOutputSha256: OUTPUT }, conversionProof, firstQualifiedGlobalBoardViolation: firstQualifiedViolation(reports, complete, conversionBound, finalBound), finalBadSiteHistories: histories, reports, limitations: ["No solver steps or output getters are invoked. All data comes from captured own-data authoritative fields.", "Declared vias, fresh guard geometry and potential physical-diameter transitions are separate representations.", "Potential transition candidates are not counted as actual manufactured vias without conversion.", "Full-stage P7 conversion is qualified only by typed connectivity roundtrip, complete route-name coverage and equality to the actual power-expansion constructor input.", "A first observed final site is not automatically the first violation or the cause of every later defect.", "No raw coordinates, route names, or unredacted source exception messages are exported."] }
}

if (import.meta.main) {
  assert(process.argv[2], "Stage capture directory required")
  const report = await auditBoundary16StageRepresentations(process.argv[2], process.argv[4] ?? process.cwd())
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n")
  console.log("BOUNDARY16_STAGE_REPRESENTATION_AUDIT_JSON " + JSON.stringify(report))
}
