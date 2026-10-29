import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { checkCopperToBoardEdgeClearance, checkViasOffBoard } from "@tscircuit/checks"
import { combinePreloadedAndRoutedTraces, evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { getPipeline9ViaBoardPlacementValidator } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaBoardPlacementValidator"
import { getPipeline9ViaPlacementValidator } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ViaPlacementValidator"
import { mapLayerNameToZ } from "../../lib/utils/mapLayerNameToZ"

type Json = any
type Point = { x: number; y: number }
const sha = (value: string | Uint8Array): string => createHash("sha256").update(typeof value === "string" ? value : new Uint8Array(value)).digest("hex")
const fileHash = (path: string): string => sha(new Uint8Array(readFileSync(path)))
const json = (path: string): Json => JSON.parse(readFileSync(path, "utf8"))

function finite(value: unknown, label: string): number {
  assert.equal(typeof value, "number", `${label} must be a number`)
  assert(Number.isFinite(value), `${label} must be finite`)
  return value as number
}

function counts(errors: Json[]): Json {
  const byType: Record<string, number> = {}
  for (const error of errors) byType[error.type] = (byType[error.type] ?? 0) + 1
  return { count: errors.length, byType }
}

function ownerResolver(source: Json[], original: Json, pairs: Json): (trace: Json) => Json {
  // Only explicit typed declarations anchor owners. Ambiguous alias references
  // remain unknown; proximity, via coordinates and rounded joins never anchor.
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id)
    let root = id
    while (parent.get(root) !== root) root = parent.get(root)!
    return root
  }
  const link = (ids: string[]): void => {
    if (ids.length === 0) return
    const roots = ids.map(find).sort()
    for (const root of roots) parent.set(root, roots[0])
  }
  const typed = new Map<string, string>()
  for (const element of source) {
    if (element.type === "source_net") typed.set(element.source_net_id, `net:${element.source_net_id}`)
    if (element.type === "source_port") typed.set(element.source_port_id, `port:${element.source_port_id}`)
    if (element.type === "source_trace") typed.set(element.source_trace_id, `trace:${element.source_trace_id}`)
  }
  for (const element of source.filter((e) => e.type === "source_trace")) {
    const ids = [typed.get(element.source_trace_id), ...(element.connected_source_net_ids ?? []).map((id: string) => typed.get(id)),
      ...(element.connected_source_port_ids ?? []).map((id: string) => typed.get(id))].filter(Boolean)
    link(ids)
  }
  for (const element of source.filter((e) => e.type === "pcb_port")) {
    if (typed.has(element.source_port_id)) typed.set(element.pcb_port_id, typed.get(element.source_port_id)!)
  }
  const aliases = new Map<string, Set<string>>()
  const add = (alias: string, roots: Set<string>): void => {
    if (!aliases.has(alias)) aliases.set(alias, new Set())
    for (const root of roots) aliases.get(alias)!.add(find(root))
  }
  for (const [alias, id] of typed) add(alias, new Set([find(id)]))
  for (const connection of [...original.connections, ...pairs.connections]) {
    const names = [connection.name, connection.source_trace_id, connection.netConnectionName, connection.__netConnectionName,
      connection.rootConnectionName, ...(connection.__rootConnectionNames ?? []), ...(connection.mergedConnectionNames ?? [])]
      .filter((name): name is string => typeof name === "string")
    const declared = [...names, ...(connection.pointsToConnect ?? []).flatMap((point: Json) => [point.pcb_port_id, point.source_port_id])]
      .filter((name): name is string => typeof name === "string")
    const roots = new Set<string>(declared.flatMap((name) => typed.has(name) ? [find(typed.get(name)!)] : []))
    for (const name of names) add(name, roots)
  }
  return (trace: Json): Json => {
    const roots = [...(aliases.get(trace.connection_name) ?? [])].map(find)
    const unique = [...new Set(roots)].sort()
    return { status: unique.length === 1 ? "ONE_TYPED_ORIGINAL_DECLARED_OWNER" : unique.length === 0 ? "UNKNOWN_UNANCHORED" : "UNKNOWN_CONFLICTING_DECLARATIONS",
      traceConnectionSha256: sha(String(trace.connection_name)), ownerSha256: unique.length === 1 ? sha(unique[0]) : null,
      candidateDeclaredOwnerCount: unique.length, interpretation: "Declared electrical owner only; not a clearance exemption or geometric connectivity proof" }
  }
}

function boundaryDiagnostic(board: Json, via: Json): Json {
  const x = finite(via.x, "via.x"), y = finite(via.y, "via.y")
  const radius = finite(via.outer_diameter, "outer diameter") / 2
  assert(radius > 0)
  const center = board.center
  const outline: Point[] = board.outline?.length >= 3 ? board.outline : [
    { x: center.x - board.width / 2, y: center.y - board.height / 2 },
    { x: center.x + board.width / 2, y: center.y - board.height / 2 },
    { x: center.x + board.width / 2, y: center.y + board.height / 2 },
    { x: center.x - board.width / 2, y: center.y + board.height / 2 },
  ]
  let inside = false, nearestDistance = Infinity, nearestEdge = -1
  for (let index = 0; index < outline.length; index++) {
    const a = outline[index], b = outline[(index + 1) % outline.length]
    for (const value of [a.x, a.y, b.x, b.y]) finite(value, "board outline")
    const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy
    if (lengthSquared === 0) continue
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared))
    const distance = Math.hypot(x - a.x - t * dx, y - a.y - t * dy)
    if (distance < nearestDistance) { nearestDistance = distance; nearestEdge = index }
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  assert(Number.isFinite(nearestDistance) && nearestEdge >= 0)
  return { boardShape: board.outline?.length >= 3 ? "declared_polygon" : "rectangle_from_declared_bounds",
    boardOutlineVertexCount: outline.length, nearestBoundaryEdgeIndex: nearestEdge,
    centerInsidePolygon: inside, centerToNearestBoundaryMm: nearestDistance,
    signedCopperEdgeMarginMm: (inside ? nearestDistance : -nearestDistance) - radius,
    minimumBoardEdgeClearanceMm: board.min_board_edge_clearance ?? null,
    interpretation: "Independent planar-circle boundary diagnostic; original checker findings remain authoritative for this screen. No raw coordinates exported." }
}

function finalRepresentationAudit(combined: Json[], circuit: Json[], via: Json): Json {
  const atVia = (point: Json): boolean => point.x === via.x && point.y === via.y
  const allMarkers = combined.flatMap((trace: Json) => trace.route.filter((point: Json) => point.route_type === "via")
    .map((point: Json) => ({ trace, point })))
  const sameTraceMarkers = allMarkers.filter(({ trace, point }) => trace.pcb_trace_id === via.pcb_trace_id && atVia(point))
  const transitions: Json[] = []
  for (const trace of combined) {
    const wires = trace.route.map((point: Json, index: number) => ({ point, index })).filter(({ point }: Json) => point.route_type === "wire")
    for (let index = 1; index < wires.length; index++) {
      const left = wires[index - 1], right = wires[index]
      if (left.point.layer === right.point.layer) continue
      transitions.push({ trace, left, right,
        between: trace.route.slice(left.index + 1, right.index).filter((point: Json) => point.route_type === "via") })
    }
  }
  const matchingTransitions = transitions.filter(({ trace, left, right }) => trace.pcb_trace_id === via.pcb_trace_id && (atVia(left.point) || atVia(right.point)))
  const materialized = circuit.filter((element) => element.type === "pcb_via" && atVia(element))
  return {
    scope: "FINAL_NORMALIZED_REPRESENTATIONS_ONLY_NO_EARLIER_HD_ROUTE_VIAS_INFERENCE",
    locationSha256: sha(JSON.stringify([via.x, via.y])),
    allFinalExplicitViaMarkerCount: allMarkers.length,
    allFinalWireLayerTransitionCount: transitions.length,
    allFinalWireCoincidentLayerTransitionCount: transitions.filter(({ left, right }) => left.point.x === right.point.x && left.point.y === right.point.y).length,
    sameTraceExactLocationMarkerCount: sameTraceMarkers.length,
    foreignTraceExactLocationMarkerCount: allMarkers.filter(({ trace, point }) => trace.pcb_trace_id !== via.pcb_trace_id && atVia(point)).length,
    sameTraceMarkers: sameTraceMarkers.map(({ point }) => ({ fromLayer: point.from_layer, toLayer: point.to_layer,
      explicitViaDiameterMm: point.via_diameter ?? null, explicitViaHoleDiameterMm: point.via_hole_diameter ?? null,
      absentDiameterMeaning: "Absent values use the original converter defaults; materialized values are listed separately" })),
    sameTraceMatchingWireTransitions: matchingTransitions.map(({ left, right, between }) => ({
      fromLayer: left.point.layer, toLayer: right.point.layer,
      bothWireEndpointsAtMaterializedVia: atVia(left.point) && atVia(right.point),
      wireEndpointSeparationMm: Math.hypot(left.point.x - right.point.x, left.point.y - right.point.y),
      interveningExplicitViaMarkerCount: between.length, leftWidthMm: left.point.width, rightWidthMm: right.point.width })),
    sameLocationMaterializedVias: materialized.map((element) => ({ materializedViaIdSha256: sha(element.pcb_via_id),
      traceIdSha256: sha(String(element.pcb_trace_id)), matchesOffendingTrace: element.pcb_trace_id === via.pcb_trace_id,
      outerDiameterMm: element.outer_diameter, holeDiameterMm: element.hole_diameter, manufacturedLayers: element.layers })),
    interpretation: "Explicit markers, transitions between consecutive final wire points, and materialized vias are counted separately. Local from/to layers are distinct from manufactured drill spans. Exact coordinate matching links only these final representations and does not establish electrical ownership or the producing stage.",
  }
}

function replayBoardPredicate(original: Json, via: Json, arm: string): Json {
  const geometry = { bounds: structuredClone(original.bounds), outline: structuredClone(original.outline),
    minBoardEdgeClearance: original.minBoardEdgeClearance }
  const placement = { x: finite(via.x, "via.x"), y: finite(via.y, "via.y"),
    viaDiameter: finite(via.outer_diameter, "via.outer_diameter"),
    zStart: mapLayerNameToZ(via.layers[0], original.layerCount),
    zEnd: mapLayerNameToZ(via.layers[via.layers.length - 1], original.layerCount) }
  const accepted = getPipeline9ViaBoardPlacementValidator(geometry)(placement)
  let ownershipAccessCount = 0
  let rejectedByCallbackBeforeOwnershipAccess: boolean | null = null
  if (!accepted) {
    // A board-rejected placement must return before *any* ownership lookup.
    // The trap proves that ordering for this final via without inventing an
    // unrecorded routingConnMap or reconstructing an original live solver.
    const context: Json = { boardGeometry: geometry, boardObstacles: original.obstacles,
      layerCount: original.layerCount, allowBlindAndBuriedVias: original.allowBlindAndBuriedVias,
      clearance: original.minViaEdgeToPadEdgeClearance ?? 0.1 }
    Object.defineProperty(context, "physicalOwnership", { get(): never {
      ownershipAccessCount++
      throw new Error("Ownership must not be accessed before original board rejection")
    } })
    const callbackResult = getPipeline9ViaPlacementValidator(context)(placement, "__offline_ownership_order_tripwire__")
    assert.equal(callbackResult, false)
    assert.equal(ownershipAccessCount, 0)
    rejectedByCallbackBeforeOwnershipAccess = true
  }
  return { frozenPredicateSource: "bd21dd642b4989b00e8279fae5c60cc7276ad642",
    replayScope: arm === "B" ? "EXACT_SOURCE_FINAL_OUTPUT_BOARD_PREDICATE_REPLAY" : "COUNTERFACTUAL_BOUNDARY_PREDICATE_ON_EE0_BASELINE_FINAL_OUTPUT",
    originalBoardFootprintAccepted: accepted, replayedDiameterMm: placement.viaDiameter,
    replayedHoleDiameterMm: via.hole_diameter, replayedManufacturedLayers: via.layers,
    rejectedByCallbackBeforeOwnershipAccess, ownershipAccessCount,
    result: accepted ? "FINAL_CHECKER_VIA_ACCEPTED_BY_FROZEN_BOARD_PREDICATE_REQUIRES_GEOMETRY_COMPARISON" : "FINAL_MATERIALIZED_VIA_REJECTED_BY_FROZEN_ORIGINAL_BOARD_PREDICATE",
    coverage: "Read-only predicate evaluation on final retained geometry. The ownership-access trap tests early board rejection, not a reconstructed routing context. Candidate-time callback invocation, earlier HD via arrays and first-producing stage were not recorded by scalar checkpoints." }
}

function auditBinding(binding: Json, packet: Json): Json {
  const { configuration } = packet
  const frozenRoot = process.cwd()
  for (const [path, expected] of Object.entries(configuration.predicateSourceHashes)) assert.equal(fileHash(join(frozenRoot, path)), expected)
  const provenance = json(join(binding.campaignDirectory, "provenance.json"))
  const harness = provenance.harnesses[binding.arm]
  assert.equal(harness.checkoutSha, binding.sourceSha)
  assert.equal(String(provenance.githubRunId), configuration.artifact.runId)
  assert.equal(provenance.controllerSha, configuration.artifact.controllerSha)
  for (const [path, expected] of Object.entries(configuration.validatorHashes)) {
    assert.equal(fileHash(join(frozenRoot, path)), expected)
    assert.equal(harness.validators[path], expected)
  }
  const dependencyHashes: Record<string, string> = {}
  for (const dependency of ["@tscircuit/checks", "circuit-json", "@tscircuit/math-utils", "@tscircuit/circuit-json-util", "circuit-json-to-connectivity-map", "high-density-repair03"]) {
    const actual = fileHash(join(frozenRoot, "node_modules", dependency, "package.json"))
    assert.equal(actual, harness.dependencyResolution.directDependencies[dependency].packageJsonSha256, `Dependency differs:${dependency}`)
    dependencyHashes[dependency] = actual
  }
  assert.equal(fileHash(join(frozenRoot, "node_modules/@tscircuit/checks/dist/index.js")), configuration.checksEntrySha256)
  assert.equal(binding.sample, 16)
  assert(["A", "B"].includes(binding.arm))
  const raw = binding.rawDirectory
  assert.equal(realpathSync(raw), realpathSync(join(binding.campaignDirectory, `round-1/sample-016/${binding.arm}/raw`)))
  for (const [name, expected] of Object.entries(binding.rawFileSha256)) assert.equal(fileHash(join(raw, name)), expected)
  const original = json(join(raw, "original-input.json")), output = json(join(raw, "raw-solver-output.json"))
  const pairs = json(join(raw, "point-pair-context.json")), traces = json(join(raw, "raw-new-traces.json"))
  assert.deepEqual(output.traces, traces)
  const capture = json(join(raw, "capture-provenance.json")), saved = json(join(raw, "supplemental-validation.json"))
  assert.deepEqual(capture.options, binding.expectedOptions)
  assert.equal(capture.inputHash, binding.expectedHashes.input)
  assert.equal(capture.rawOutputHash, binding.expectedHashes.output)
  assert.equal(capture.rawNewTracesHash, binding.expectedHashes.traces)
  assert.equal(capture.inputMutated, false)
  assert.equal(capture.solverSolved, true)
  assert.equal(capture.solverFailed, false)
  assert.equal(capture.solverError, null)
  const sourceSpec = configuration.originalSourceCircuitJson
  assert.equal(original.sourceCircuitJson, sourceSpec.relativePath)
  const sourcePath = join(frozenRoot, "node_modules", sourceSpec.packageName, sourceSpec.relativePath)
  assert.equal(fileHash(sourcePath), sourceSpec.sha256)
  const originalSource = json(sourcePath)
  const evaluated = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: pairs, routedTraces: traces, includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, holeClearance: original.minTraceToHoleEdgeClearance, includeTraceContinuity: true, includeTypedTraceClearance: true } })
  const circuit = evaluated.circuitJson as Json[]
  const boardChecks = checkCopperToBoardEdgeClearance(circuit), viaChecks = checkViasOffBoard(circuit)
  for (const [name, errors] of [["referenceFullCopperChecks", evaluated.errors], ["boardCopperChecks", boardChecks], ["viaBoardChecks", viaChecks]] as const) {
    assert.deepEqual(counts(errors), { count: saved[name].count, byType: saved[name].byType }, `Original retained findings differ:${name}`)
  }
  const boards = circuit.filter((element) => element.type === "pcb_board")
  assert.equal(boards.length, 1)
  const board = boards[0], combined = combinePreloadedAndRoutedTraces(original.traces ?? [], traces)
  const resolveOwner = ownerResolver(originalSource, original, pairs)
  const findings = viaChecks.map((error: Json) => {
    const viaId = error.pcb_placement_error_id.replace(/^out_of_board_/, "")
    const vias = circuit.filter((element) => element.type === "pcb_via" && element.pcb_via_id === viaId)
    assert.equal(vias.length, 1)
    const via = vias[0], traceMatches = combined.filter((trace: Json) => trace.pcb_trace_id === via.pcb_trace_id)
    const owner = traceMatches.length === 1 ? resolveOwner(traceMatches[0]) : { status: "UNKNOWN_TRACE_ID_NOT_UNIQUE", traceMatchCount: traceMatches.length }
    return { findingType: error.type, materializedViaIdSha256: sha(viaId), traceIdSha256: sha(String(via.pcb_trace_id)),
      owner, viaDimensions: { outerDiameterMm: finite(via.outer_diameter, "outer diameter"), holeDiameterMm: finite(via.hole_diameter, "hole diameter"), layers: via.layers },
      alsoInBoardCopperCheck: boardChecks.some((finding: Json) => finding.pcb_placement_error_id === `copper_too_close_to_board_edge_${viaId}`),
      isFromNewTraceId: traces.some((trace: Json) => trace.pcb_trace_id === via.pcb_trace_id),
      isFromPreloadedTraceId: (original.traces ?? []).some((trace: Json) => trace.pcb_trace_id === via.pcb_trace_id),
      boundary: boundaryDiagnostic(board, via),
      finalRepresentations: finalRepresentationAudit(combined, circuit, via),
      frozenBoundaryPredicateReplay: replayBoardPredicate(original, via, binding.arm) }
  })
  assert.equal(findings.length, 1)
  return { sample: 16, arm: binding.arm, sourceSha: binding.sourceSha, options: binding.expectedOptions, hashes: binding.expectedHashes,
    rawFileSha256: binding.rawFileSha256, sourceCircuitJsonSha256: sourceSpec.sha256, evaluatorSha256: configuration.validatorHashes,
    checksEntrySha256: configuration.checksEntrySha256, dependencyPackageSha256: dependencyHashes,
    materializedCircuitJsonSha256: sha(JSON.stringify(circuit)), materializedBoardCount: boards.length,
    materializedViaCount: circuit.filter((element) => element.type === "pcb_via").length,
    declaredOriginalViaPadDiameterMm: original.minViaDiameter ?? null, declaredOriginalViaHoleDiameterMm: original.minViaHoleDiameter ?? null,
    boardCopperChecks: counts(boardChecks), viaBoardChecks: counts(viaChecks), referenceFullCopperChecks: counts(evaluated.errors), findings,
    finalOutputShape: { topLevelKeys: Object.keys(output).sort(), traceCount: traces.length,
      finalRouteViasArrayCount: combined.filter((trace: Json) => Array.isArray(trace.vias)).length,
      representationLabel: "Final normalized SimplifiedPcbTrace output only. A final field named vias is not an earlier HD route.vias snapshot." },
    predicateSourceHashes: configuration.predicateSourceHashes,
    firstProducingStage: "UNDETERMINED_FROM_EXISTING_SCALAR_CHECKPOINTS_AND_FINAL_OUTPUT",
    interpretation: "One final materialized via may produce both boardCopperChecks and viaBoardChecks. Frozen source board-predicate replay diagnoses final geometry only. No earlier HD vias arrays or stage origin are inferred from final normalized traces." }
}

const packet = json(resolve(process.argv[2]))
assert.equal(fileHash(packet.strictQualificationReceipt.path), packet.strictQualificationReceipt.sha256)
assert.equal(packet.bindings.length, 2)
assert.deepEqual(packet.bindings.map((binding: Json) => binding.arm), ["A", "B"])
const reports = packet.bindings.map((binding: Json) => auditBinding(binding, packet))
const result = { scope: packet.configuration.scope, artifact: { artifactId: packet.configuration.artifact.artifactId,
  runId: packet.configuration.artifact.runId, controllerSha: packet.configuration.artifact.controllerSha,
  zipSha256: packet.configuration.artifact.zipSha256 }, strictQualificationReceiptSha256: packet.strictQualificationReceipt.sha256,
  reports, coverage: "Original reference and board/via checks plus bounded declared-owner and circular-via boundary diagnostics. No solver execution, output edits, inference of electrical connectivity from proximity, or public raw PCB geometry." }
writeFileSync(resolve(process.argv[3]), JSON.stringify(result, null, 2) + "\n")
