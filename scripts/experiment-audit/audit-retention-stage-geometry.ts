import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { basename, resolve, sep } from "node:path"

type Json = any
type OwnerResult = { status: "resolved" | "ambiguous" | "unknown"; owners: string[]; proof: string[] }
type OriginalOwners = { resolveTokens: (tokens: { type?: string; value: Json }[]) => OwnerResult; trace: (trace: Json) => OwnerResult; obstacle: (obstacle: Json) => OwnerResult }
type RouteBundle = { routes: Json[]; format: "hd" | "traces"; field: string; coordinateFrame: "world-mm" }
type Via = { x: number; y: number; diameter: number; hole: number; owner: OwnerResult; routeId: string; siteSha256: string }
const SOURCE = "74de6cea4bd39c9aa41e9d492b003a892abd1596"
const INPUT = "4a513349694b8558e159dfc88eda8344f1b6158c63f89f558a9cc8c2fa0bf71e"
const FINAL_TRACES = "fc2ccedd14c9284ccee18f7b7b8377ebe0757927d6fc1ddc2025c8c0f93d59e6"
const FINAL_OUTPUT = "fddfe5c3cd2d37dbac1f47b65a96d7527bee14c88d40132108b381ab8f38d863"
const PHASES = ["highDensityRouteSolver", "highDensityForceImproveSolver", "highDensityRepairSolver", "highDensityStitchSolver", "traceSimplificationSolver", "mutatedPreloadedTraceSimplificationSolver", "traceWidthSolver", "globalDrcForceImproveSolver", "pipeline9JointDrcRepairSolver", "effortCleanupSolver", "lengthMatchingPostProcessingSolver", "powerTraceExpansionSolver"]
const sha = (value: string): string => createHash("sha256").update(value).digest("hex")
const strings = (values: Json[]): string[] => values.filter((x): x is string => typeof x === "string" && x.length > 0)
const sorted = (values: string[]): string[] => [...new Set(values)].sort()

// Electrical components come ONLY from original declared connections and typed
// terminal IDs. No coordinate matching, rounded helper IDs, processed aliases,
// obstacle connectivity_net tokens or physical contact can union owners.
export function originalOwners(original: Json): OriginalOwners {
  const parent = new Map<string, string>()
  const find = (key: string): string => {
    if (!parent.has(key)) parent.set(key, key)
    const previous = parent.get(key)!
    if (previous !== key) parent.set(key, find(previous))
    return parent.get(key)!
  }
  const unite = (a: string, b: string): void => {
    const ar = find(a), br = find(b)
    if (ar !== br) parent.set(br, ar)
  }
  const registry = new Map<string, Set<string>>()
  const declare = (type: string, value: Json, owner: string): void => {
    if (typeof value !== "string" || !value) return
    const key = JSON.stringify([type, value])
    unite(owner, key)
    if (!registry.has(value)) registry.set(value, new Set())
    registry.get(value)!.add(key)
  }
  original.connections.forEach((connection: Json, index: number) => {
    const owner = `original-connection:${index}`
    find(owner)
    declare("connection-name", connection.name, owner)
    declare("source-trace", connection.source_trace_id, owner)
    declare("source-net", connection.source_net_id, owner)
    for (const point of connection.pointsToConnect ?? []) {
      declare("pcb-port", point.pcb_port_id, owner)
      declare("point-id", point.pointId, owner)
      declare("source-port", point.source_port_id, owner)
    }
  })
  const names = new Map<string, string[]>()
  original.connections.forEach((connection: Json, index: number) => {
    const owner = find(`original-connection:${index}`)
    names.set(owner, sorted([...(names.get(owner) ?? []), connection.name]))
  })
  const resolveTokens = (tokens: { type?: string; value: Json }[]): OwnerResult => {
    const roots = new Set<string>()
    const proof: string[] = []
    for (const { type, value } of tokens) {
      if (typeof value !== "string") continue
      const keys = type ? [JSON.stringify([type, value])].filter((key) => parent.has(key)) : [...(registry.get(value) ?? [])]
      for (const key of keys) { roots.add(find(key)); proof.push(key) }
    }
    return { status: roots.size === 1 ? "resolved" : roots.size ? "ambiguous" : "unknown", owners: [...roots].map((root) => (names.get(root) ?? [root]).join("|" )).sort(), proof: sorted(proof) }
  }
  return {
    resolveTokens,
    trace: (trace: Json) => resolveTokens([{ type: "connection-name", value: trace.connection_name }, { type: "source-trace", value: trace.source_trace_id }]),
    obstacle: (obstacle: Json) => resolveTokens([
      { type: "pcb-port", value: obstacle.circuitJsonMetadata?.pcb_port_id },
      ...strings(obstacle.connectedTo ?? []).map((value) => ({ value })),
    ]),
  }
}

// Independent circle-to-oriented-rectangle/circle signed surface distance.
// This uses original obstacle geometry, not the checker's distance helper.
export function viaObstacleGap(via: Json, obstacle: Json): number {
  const radius = via.outer_diameter / 2
  assert(Number.isFinite(radius) && radius > 0, "Nonfinite via pad radius")
  const dx = via.x - obstacle.center.x, dy = via.y - obstacle.center.y
  if ((obstacle.shape ?? obstacle.type) === "circle") return Math.hypot(dx, dy) - obstacle.width / 2 - radius
  assert(["rect", "rectangle", undefined].includes(obstacle.shape ?? obstacle.type), "Unsupported original pad shape")
  const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
  const localX = Math.cos(angle) * dx + Math.sin(angle) * dy
  const localY = -Math.sin(angle) * dx + Math.cos(angle) * dy
  const ex = Math.abs(localX) - obstacle.width / 2
  const ey = Math.abs(localY) - obstacle.height / 2
  return Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) + Math.min(Math.max(ex, ey), 0) - radius
}

/** Restore only serialized own-data containers, never executable functions. */
export function decodeCaptureData(value: Json): Json {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(decodeCaptureData)
  const keys = Object.keys(value)
  if (keys.length === 1 && value.$undefined === true) return undefined
  if (keys.length === 1 && Array.isArray(value.$map)) {
    assert(value.$map.every((entry: Json) => Array.isArray(entry) && entry.length === 2), "Malformed captured Map")
    const map = new Map(value.$map.map((entry: Json[]) => entry.map(decodeCaptureData)))
    assert.equal(map.size, value.$map.length, "Duplicate captured Map key")
    return map
  }
  if (keys.length === 1 && Array.isArray(value.$set)) return new Set(value.$set.map(decodeCaptureData))
  const result = Object.create(null)
  for (const [key, item] of Object.entries(value)) result[key] = decodeCaptureData(item)
  return result
}

function arrayField(value: Json, field: string): Json[] {
  assert(value && Object.hasOwn(value, field) && Array.isArray(value[field]), `Missing authoritative route field: ${field}`)
  assert(value[field].every((item: Json) => item && typeof item === "object" && !Array.isArray(item)), `Invalid route array: ${field}`)
  return value[field]
}

function overlayRoutes(value: Json, mapField: string): Json[] {
  const routes = arrayField(value, "originalHdRoutes")
  assert(value[mapField] instanceof Map, `Missing captured typed Map: ${mapField}`)
  for (const [key, route] of value[mapField]) {
    assert(Number.isSafeInteger(key) && key >= 0 && key < routes.length, `Invalid ${mapField} route index`)
    assert(route && typeof route === "object" && !Array.isArray(route), `Invalid ${mapField} route replacement`)
  }
  return routes.map((route, index) => value[mapField].has(index) ? value[mapField].get(index) : route)
}

/** Only aggregate world outputs of the exact reviewed74de source are accepted.
 * Native node/worker-local output and guessed translations are never inspected.
 * The74de materializePipeline9HdRouteVias contract explicitly defines route XY
 * as board-world millimeters and Z as the original board layer index.
 */
export function extractRouteBundle(snapshot: Json, algorithmSha = SOURCE): RouteBundle | null {
  assert.equal(algorithmSha, SOURCE, "Unknown algorithm coordinate-frame contract")
  const { phase, boundary, value } = snapshot
  if (boundary === "original_input" || boundary === "pipeline_context") return null
  if (boundary === "final_output") return { routes: arrayField(value, "traces"), format: "traces", field: "traces", coordinateFrame: "world-mm" }
  assert(PHASES.includes(phase), "Unknown stage route/coordinate contract")
  if (boundary === "constructor_params_return") {
    assert(Array.isArray(value) && value.length > 0 && value[0] && typeof value[0] === "object", "Missing constructor arguments")
    const params = value[0]
    if (phase === "highDensityRouteSolver") {
      assert(Array.isArray(params.nodePortPoints), "Missing world node port-point context")
      return null
    }
    const field = phase === "pipeline9JointDrcRepairSolver" ? "newHdRoutes" : phase === "powerTraceExpansionSolver" ? "traces" : "hdRoutes"
    const container = phase === "effortCleanupSolver" ? params.config : params
    return { routes: arrayField(container, field), format: phase === "powerTraceExpansionSolver" ? "traces" : "hd", field: phase === "effortCleanupSolver" ? "config.hdRoutes" : field, coordinateFrame: "world-mm" }
  }
  assert.equal(boundary, "completed_phase", "Unknown route boundary")
  assert.equal(value.solved, true, "Stage output is not completed")
  assert.equal(value.failed, false, "Stage reports failure")
  if (phase === "highDensityForceImproveSolver" || phase === "highDensityRepairSolver") {
    const map = phase === "highDensityForceImproveSolver" ? "improvedRoutesByIndex" : "repairedRoutesByIndex"
    return { routes: overlayRoutes(value, map), format: "hd", field: `originalHdRoutes+${map}`, coordinateFrame: "world-mm" }
  }
  if (phase === "pipeline9JointDrcRepairSolver") {
    let routes: Json[], field: string
    if (value.combinedOutput !== undefined) { routes = arrayField(value, "combinedOutput"); field = "combinedOutput" }
    else if (value.exactRepairSolver !== undefined) { routes = arrayField(value.exactRepairSolver, "outputHdRoutes"); field = "exactRepairSolver.outputHdRoutes" }
    else { routes = arrayField(value, "inputNewHdRoutes"); field = "inputNewHdRoutes(no exact solver)" }
    assert(value.syntheticConnectionNames instanceof Set, "Missing typed synthetic-name filter")
    return { routes: routes.filter((route) => !value.syntheticConnectionNames.has(route.connectionName)), format: "hd", field, coordinateFrame: "world-mm" }
  }
  if (phase === "powerTraceExpansionSolver") return { routes: arrayField(value.powerTraceExpanderSolver, "lastConnectivitySafeTraces"), format: "traces", field: "powerTraceExpanderSolver.lastConnectivitySafeTraces", coordinateFrame: "world-mm" }
  const fields: Record<string, string> = {
    highDensityRouteSolver: "routes", highDensityStitchSolver: "mergedHdRoutes",
    // The pinned simplifier getter simplifiedHdRoutes returns its own hdRoutes.
    traceSimplificationSolver: "hdRoutes", mutatedPreloadedTraceSimplificationSolver: "hdRoutes",
    traceWidthSolver: "hdRoutesWithWidths", globalDrcForceImproveSolver: "outputHdRoutes",
    effortCleanupSolver: "bestRoutes", lengthMatchingPostProcessingSolver: "outputHdRoutes",
  }
  assert(fields[phase], "Missing authoritative output adapter")
  return { routes: arrayField(value, fields[phase]), format: "hd", field: fields[phase], coordinateFrame: "world-mm" }
}

function ownerContext(original: Json, contexts: Json[]): { route: (route: Json) => OwnerResult; obstacle: OriginalOwners["obstacle"] } {
  const base = originalOwners(original)
  const aliases = new Map<string, OwnerResult>()
  const pending: { name: string; tokens: { type?: string; value: Json }[] }[] = []
  for (const context of contexts) {
    const pairs = context.srjWithPointPairs?.connections
    if (Array.isArray(pairs)) for (const connection of pairs) pending.push({ name: connection.name, tokens: [
      { type: "connection-name", value: connection.name },
      { type: "source-trace", value: connection.source_trace_id },
      { type: "source-net", value: connection.source_net_id },
      { type: "connection-name", value: connection.__netConnectionName },
      ...(connection.__rootConnectionNames ?? []).map((value: string) => ({ type: "connection-name", value })),
      ...(connection.pointsToConnect ?? []).flatMap((point: Json) => [{ type: "pcb-port", value: point.pcb_port_id }, { type: "point-id", value: point.pointId }]),
    ] })
    const netMap = context.connMap?.netMap
    if (netMap && typeof netMap === "object") for (const [name, members] of Object.entries(netMap)) {
      assert(Array.isArray(members), "Captured connMap.netMap member list is not plain data")
      pending.push({ name, tokens: members.map((value) => ({ value })) })
    }
  }
  const resolveAll = (tokens: { type?: string; value: Json }[]): OwnerResult => {
    const results = [base.resolveTokens(tokens), ...tokens.filter((token) => typeof token.value === "string" && aliases.has(token.value)).map((token) => aliases.get(token.value)!)]
    const owners = sorted(results.flatMap((result) => result.owners))
    return { status: results.some((result) => result.status === "ambiguous") || owners.length > 1 ? "ambiguous" : owners.length === 1 ? "resolved" : "unknown", owners, proof: sorted(results.flatMap((result) => result.proof)) }
  }
  for (let pass = 0; pass <= pending.length; pass++) {
    let changed = false
    for (const item of pending) {
      const result = resolveAll(item.tokens)
      if (result.status === "unknown") continue
      const previous = aliases.get(item.name)
      const owners = sorted([...(previous?.owners ?? []), ...result.owners])
      const combined: OwnerResult = { status: previous?.status === "ambiguous" || result.status === "ambiguous" || owners.length > 1 ? "ambiguous" : "resolved", owners, proof: sorted([...(previous?.proof ?? []), ...result.proof]) }
      if (JSON.stringify(previous) !== JSON.stringify(combined)) { aliases.set(item.name, combined); changed = true }
    }
    if (!changed) break
    assert(pass < pending.length, "Derived owner resolution did not converge")
  }
  return { obstacle: base.obstacle, route: (route: Json): OwnerResult => resolveAll([
    { type: "connection-name", value: route.connection_name ?? route.connectionName },
    { type: "connection-name", value: route.rootConnectionName },
    { type: "source-trace", value: route.source_trace_id },
    { type: "pcb-port", value: route.startPcbPortId }, { type: "pcb-port", value: route.endPcbPortId },
    ...((route.route ?? []) as Json[]).flatMap((point) => [{ type: "pcb-port", value: point.start_pcb_port_id }, { type: "pcb-port", value: point.end_pcb_port_id }]),
  ]) }
}

function viaDimensions(original: Json, route: Json, point?: Json): { diameter: number; hole: number } {
  const requestedPad = original.min_via_pad_diameter ?? original.minViaPadDiameter ?? original.minViaDiameter ?? 0.3
  const requestedHole = original.min_via_hole_diameter ?? original.minViaHoleDiameter
  const diameter = point?.via_diameter ?? route.viaDiameter ?? Math.max(requestedPad, requestedHole ?? 0)
  const hole = point?.via_hole_diameter ?? requestedHole ?? diameter * 0.5
  assert(Number.isFinite(diameter) && Number.isFinite(hole) && hole > 0 && diameter >= hole, "Unknown manufactured via dimensions")
  return { diameter, hole }
}

/** Audit actual explicit vias; ordinary inner-layer wires are never promoted to vias. */
export function auditRouteBundle(original: Json, bundle: RouteBundle, contexts: Json[] = []): Json {
  const issues: string[] = [], vias: Via[] = [], findings: Json[] = [], potentialUnknownContacts: Json[] = []
  assert.equal(bundle.coordinateFrame, "world-mm", "Unsupported coordinate frame")
  assert(Number.isSafeInteger(original.layerCount) && original.layerCount >= 2 && original.layerCount <= 32, "Unknown original copper-layer stack")
  assert(Array.isArray(original.connections) && Array.isArray(original.obstacles), "Missing original declared ownership/pads")
  assert(original.allowBlindAndBuriedVias !== true, "Unsupported blind/buried manufacturing span")
  const layers = ["top", ...Array.from({ length: original.layerCount - 2 }, (_, i) => `inner${i + 1}`), "bottom"]
  const owners = ownerContext(original, contexts)
  const clearance = original.minViaEdgeToPadEdgeClearance ?? 0.1, tolerance = 0.005
  assert(Number.isFinite(clearance) && clearance >= 0, "Unknown via-to-pad rule")
  for (const [routeIndex, route] of bundle.routes.entries()) {
    try {
      assert(Array.isArray(route.route), "Missing complete route points")
      const owner = owners.route(route)
      if (owner.status !== "resolved") issues.push(`route:${routeIndex}:original-owner-${owner.status}`)
      const positions: Json[] = []
      if (bundle.format === "traces") {
        for (const point of route.route) {
          assert(point?.route_type === "wire" || point?.route_type === "via", "Unsupported trace primitive")
          if (point.route_type === "wire") assert(layers.includes(point.layer), "Unknown wire layer")
          else {
            assert(layers.includes(point.from_layer) && layers.includes(point.to_layer) && point.from_layer !== point.to_layer, "Invalid explicit via transition")
            positions.push(point)
          }
        }
      } else {
        assert(Array.isArray(route.vias), "Missing explicit HD via array")
        for (const point of route.route) assert(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isSafeInteger(point.z) && point.z >= 0 && point.z < layers.length, "Invalid world HD coordinate/layer")
        positions.push(...route.vias)
        for (let index = 1; index < route.route.length; index++) {
          const a = route.route[index - 1], b = route.route[index]
          if (a.z === b.z || a.toNextSegmentType === "through_obstacle") continue
          const same = Math.abs(a.x - b.x) <= 1e-6 && Math.abs(a.y - b.y) <= 1e-6
          const atA = route.vias.some((via: Json) => Math.abs(via.x - a.x) <= 1e-6 && Math.abs(via.y - a.y) <= 1e-6)
          const atB = route.vias.some((via: Json) => Math.abs(via.x - b.x) <= 1e-6 && Math.abs(via.y - b.y) <= 1e-6)
          if (same) positions.push({ x: a.x, y: a.y })
          else assert(atA !== atB, "Ambiguous/unrepresented HD layer-transition via")
        }
      }
      const seen = new Set<string>()
      for (const point of positions) {
        assert(Number.isFinite(point.x) && Number.isFinite(point.y), "Invalid world via coordinate")
        const dimensions = viaDimensions(original, route, point)
        const siteSha256 = sha(JSON.stringify([owner.owners, point.x, point.y, layers, dimensions.diameter, dimensions.hole]))
        if (seen.has(siteSha256)) continue
        seen.add(siteSha256)
        vias.push({ x: point.x, y: point.y, ...dimensions, owner, routeId: route.pcb_trace_id ?? route.connectionName ?? `route:${routeIndex}`, siteSha256 })
      }
    } catch (error) { issues.push(`route:${routeIndex}:${String(error).slice(0, 220)}`) }
  }
  const uniqueVias = new Map(vias.map((via) => [via.siteSha256, via]))
  for (const via of uniqueVias.values()) for (const [index, obstacle] of original.obstacles.entries()) {
    if (obstacle.isNonPlatedHole) continue
    try {
      assert(obstacle.center && [obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height, obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) && obstacle.width > 0 && obstacle.height > 0, "Invalid original pad geometry")
      assert(Array.isArray(obstacle.layers) && obstacle.layers.length > 0 && obstacle.layers.every((layer: string) => layers.includes(layer)), "Unknown original pad layer span")
      const owner = owners.obstacle(obstacle)
      if (via.owner.status === "resolved" && owner.status === "resolved" && via.owner.owners[0] === owner.owners[0]) continue
      // A distant bounding circle excludes a pad independent of its exact shape.
      if (Math.hypot(via.x - obstacle.center.x, via.y - obstacle.center.y) - Math.hypot(obstacle.width, obstacle.height) / 2 - via.diameter / 2 >= clearance - tolerance) continue
      const padId = obstacle.circuitJsonMetadata?.pcb_smtpad_id ?? obstacle.circuitJsonMetadata?.pcb_plated_hole_id ?? obstacle.obstacleId ?? `original-obstacle:${index}`
      const shape = obstacle.shape ?? obstacle.type
      if (shape === "oval") {
        // Legacy SRJs do not define ellipse versus capsule corner geometry.
        // Their declared rotated width/height rectangle encloses either shape;
        // outside that envelope is provably clear without inventing its copper.
        const enclosureGap = viaObstacleGap({ x: via.x, y: via.y, outer_diameter: via.diameter }, { ...obstacle, type: "rect", shape: undefined })
        if (enclosureGap >= clearance - tolerance) continue
        potentialUnknownContacts.push({ viaSiteSha256: via.siteSha256, routeId: via.routeId, viaOwner: via.owner.owners, padId, originalObstacleIndex: index, padOwner: owner.owners, reason: "LEGACY_OVAL_EXACT_COPPER_SHAPE_NOT_DECLARED", enclosingRectangleGapMm: enclosureGap, requiredCopperGapMm: clearance, toleranceMm: tolerance })
        continue
      }
      assert(["rect", "rectangle", "circle", undefined].includes(shape), "Unsupported exact original pad shape")
      if (shape === "circle") assert(Math.abs(obstacle.width - obstacle.height) < 1e-12, "Elliptical pad is not a circle")
      const gap = viaObstacleGap({ x: via.x, y: via.y, outer_diameter: via.diameter }, obstacle)
      if (gap >= clearance - tolerance) continue
      const contact = { viaSiteSha256: via.siteSha256, routeId: via.routeId, viaOwner: via.owner.owners, padId, originalObstacleIndex: index, padOwner: owner.owners, signedCopperGapMm: gap, requiredCopperGapMm: clearance, toleranceMm: tolerance, viaOuterDiameterMm: via.diameter, viaHoleDiameterMm: via.hole, manufacturedLayers: layers, padLayers: obstacle.layers }
      if (obstacle.circuitJsonMetadata?.pcb_plated_hole_id) {
        potentialUnknownContacts.push({ ...contact, reason: "PLATED_PAD_DRILL_VOID_GEOMETRY_NOT_DECLARED_IN_SRJ" })
      } else if (via.owner.status !== "resolved" || owner.status !== "resolved") {
        potentialUnknownContacts.push({ ...contact, reason: "ORIGINAL_TYPED_OWNERSHIP_UNRESOLVED" })
      } else findings.push({ ...contact, verdict: "FOREIGN_ORIGINAL_OWNER_VIA_PAD_CLEARANCE_VIOLATION" })
    } catch (error) { issues.push(`pad:${index}:${String(error).slice(0, 220)}`) }
  }
  return { status: issues.length || potentialUnknownContacts.length ? "INCOMPLETE" : "COMPLETE", viaPadClearancePassed: issues.length || potentialUnknownContacts.length ? null : findings.length === 0, coordinateFrame: bundle.coordinateFrame, field: bundle.field, routeCount: bundle.routes.length, explicitViaOccurrences: vias.length, uniqueManufacturedViaSites: uniqueVias.size, fullOriginalPadCount: original.obstacles.filter((obstacle: Json) => !obstacle.isNonPlatedHole).length, findingCount: findings.length, findings, unknownContactCount: potentialUnknownContacts.length, potentialUnknownContacts, issues: sorted(issues), limits: "Via-to-original-pad audit only; other physical/connectivity rules are unchanged and outside this report. Plated drill voids and unsupported geometry never become filled copper or a false clean count." }
}

export function auditStageCapture(directory: string, binding: Json = {}): Json {
  const root = resolve(directory), manifestText = readFileSync(resolve(root, "manifest.json"), "utf8"), manifest = JSON.parse(manifestText)
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.algorithmSha, SOURCE)
  assert.equal(manifest.dataset, "srj18"); assert.equal(manifest.originalSample, 14); assert.equal(manifest.inputSha256, INPUT)
  assert.equal(manifest.diagnosticOnly, true); assert.equal(manifest.timingQualified, false)
  for (const [key, expected] of Object.entries(binding)) assert.deepEqual(manifest[key], expected, `Unexpected capture binding: ${key}`)
  assert(Array.isArray(manifest.records) && manifest.records.length > 0, "Missing capture inventory")
  const snapshots: Json[] = [], seen = new Set<string>(), sourceHashes = new Set<string>()
  const requiredBoundaries = ["original_input:pipeline", ...PHASES.flatMap((phase) => phase === "highDensityRouteSolver" ? [`constructor_params_return:${phase}`, `pipeline_context:${phase}`, `completed_phase:${phase}`] : [`constructor_params_return:${phase}`, `completed_phase:${phase}`]), "final_output:pipeline"]
  for (const [index, record] of manifest.records.entries()) {
    assert.equal(record.sequence, index)
    assert.equal(basename(record.file), record.file, "Capture filename leaves directory")
    const path = resolve(root, record.file)
    assert(path.startsWith(root + sep), "Capture path leaves root")
    const text = readFileSync(path, "utf8")
    assert.equal(Buffer.byteLength(text), record.bytes); assert.equal(sha(text), record.sha256)
    const data = JSON.parse(text)
    assert.equal(data.schemaVersion, 1); assert.equal(data.diagnosticOnly, true); assert.equal(data.timingQualified, false)
    for (const key of ["algorithmSha", "controllerSha", "githubRunId", "arm", "dataset", "originalSample", "inputSha256", "campaign", "executionOrder"]) assert.deepEqual(data.metadata[key], manifest[key], `Snapshot metadata binding changed: ${key}`)
    assert.equal(data.sourceSha256, manifest.sourceSha256); sourceHashes.add(data.sourceSha256)
    assert.equal(data.phase, record.phase); assert.equal(data.boundary, record.boundary)
    const key = `${data.boundary}:${data.phase}`
    assert(!seen.has(key), "Duplicate boundary identity"); seen.add(key)
    snapshots.push({ ...data, value: decodeCaptureData(data.value), recordSha256: record.sha256, sequence: index })
  }
  assert.equal(sourceHashes.size, 1)
  const inputs = snapshots.filter((snapshot) => snapshot.boundary === "original_input" && snapshot.phase === "pipeline")
  assert.equal(inputs.length, 1, "Exactly one original SRJ required")
  const original = inputs[0].value
  assert.equal(sha(JSON.stringify(original)), INPUT, "Original SRJ raw hash mismatch")
  const contexts = snapshots.filter((snapshot) => snapshot.boundary === "pipeline_context").map((snapshot) => snapshot.value)
  assert.equal(contexts.length, 1, "One exact point-pair ownership context required")
  const reports: Json[] = []
  for (const snapshot of snapshots) {
    if (snapshot.boundary === "original_input" || snapshot.boundary === "pipeline_context") continue
    try {
      const bundle = extractRouteBundle(snapshot, manifest.algorithmSha)
      if (bundle) reports.push({ sequence: snapshot.sequence, phase: snapshot.phase, boundary: snapshot.boundary, rawSha256: snapshot.recordSha256, ...auditRouteBundle(original, bundle, contexts) })
    } catch (error) { reports.push({ sequence: snapshot.sequence, phase: snapshot.phase, boundary: snapshot.boundary, rawSha256: snapshot.recordSha256, status: "INCOMPLETE", findingCount: null, issues: [String(error).slice(0, 320)] }) }
  }
  const finals = snapshots.filter((snapshot) => snapshot.boundary === "final_output")
  let finalBinding: Json = { status: "MISSING", timingQualified: false }
  if (finals.length === 1) {
    const tracesHash = sha(JSON.stringify(finals[0].value.traces)), outputHash = sha(JSON.stringify(finals[0].value.output))
    finalBinding = { status: tracesHash === FINAL_TRACES && outputHash === FINAL_OUTPUT ? "MATCH_KNOWN_74DE_14B_RETAINED_OUTPUT" : "DIFFERENT_RAW_OUTPUT_DO_NOT_INHERIT_OLD_CAUSAL_CLAIMS", tracesSha256: tracesHash, outputSha256: outputHash, expectedTracesSha256: FINAL_TRACES, expectedOutputSha256: FINAL_OUTPUT }
  }
  const missingCompletedPhases = PHASES.filter((phase) => !reports.some((report) => report.phase === phase && report.boundary === "completed_phase" && report.status === "COMPLETE"))
  const missingBoundaries = requiredBoundaries.filter((boundary) => !seen.has(boundary))
  const unexpectedBoundaries = [...seen].filter((boundary) => !requiredBoundaries.includes(boundary))
  const boundaryOrderQualified = JSON.stringify([...seen]) === JSON.stringify(requiredBoundaries)
  const capturesComplete = boundaryOrderQualified && Array.isArray(manifest.errors) && manifest.errors.length === 0 && missingBoundaries.length === 0 && unexpectedBoundaries.length === 0 && missingCompletedPhases.length === 0 && reports.every((report) => report.status === "COMPLETE") && finals.length === 1
  const firstBad = reports.find((report) => report.findingCount > 0)
  const firstCompletedBad = reports.find((report) => report.boundary === "completed_phase" && report.findingCount > 0)
  const priorClear = firstCompletedBad && reports.filter((report) => report.sequence < firstCompletedBad.sequence).every((report) => report.status === "COMPLETE" && report.findingCount === 0)
  const finalReport = reports.find((report) => report.boundary === "final_output")
  const finalFindingOrigins = (finalReport?.findings ?? []).map((finding: Json) => {
    const first = reports.find((report) => report.findings?.some((candidate: Json) => candidate.viaSiteSha256 === finding.viaSiteSha256 && candidate.originalObstacleIndex === finding.originalObstacleIndex))
    return { viaSiteSha256: finding.viaSiteSha256, viaOwner: finding.viaOwner, padId: finding.padId, firstObserved: first ? { phase: first.phase, boundary: first.boundary, sequence: first.sequence, rawSha256: first.rawSha256 } : null }
  })
  return { status: capturesComplete ? "COMPLETE_OFFLINE_STAGE_AUDIT" : "INCOMPLETE_DO_NOT_CLAIM_FIRST_PRODUCING_STAGE", diagnosticOnly: true, timingQualified: false, metadata: { algorithmSha: manifest.algorithmSha, controllerSha: manifest.controllerSha, githubRunId: manifest.githubRunId, captureSourceSha256: manifest.sourceSha256, arm: manifest.arm, dataset: manifest.dataset, originalSample: manifest.originalSample, inputSha256: INPUT }, manifestSha256: sha(manifestText), recordCount: snapshots.length, captureErrors: manifest.errors, boundaryOrderQualified, missingBoundaries, unexpectedBoundaries, missingCompletedPhases, finalBinding, firstObservedViolation: firstBad ? { phase: firstBad.phase, boundary: firstBad.boundary, sequence: firstBad.sequence } : null, firstIntroducingStage: capturesComplete && priorClear && finalBinding.status === "MATCH_KNOWN_74DE_14B_RETAINED_OUTPUT" ? firstCompletedBad.phase : null, finalFindingOrigins, reports, limits: "Only exact frozen74de aggregate world-route contracts are adapted. No guessed native-node translation, new routing, solver/output-method invocation, performance claim, checker change, or omitted unknown context. A first captured violation is not automatically the cause of every later final violation." }
}

if (import.meta.main) {
  assert(process.argv[2], "Captured stage-geometry directory is required")
  const binding: Json = { sourceSha256: sha(readFileSync(new URL("./stage-geometry-capture.ts", import.meta.url), "utf8")) }
  if (process.env.GITHUB_SHA) binding.controllerSha = process.env.GITHUB_SHA
  if (process.env.GITHUB_RUN_ID) binding.githubRunId = process.env.GITHUB_RUN_ID
  const report = auditStageCapture(process.argv[2], binding)
  if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify(report, null, 2) + "\n")
  console.log("RETENTION_STAGE_GEOMETRY_AUDIT_JSON " + JSON.stringify(report))
}
