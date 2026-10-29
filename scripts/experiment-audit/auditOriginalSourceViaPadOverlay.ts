import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { checkViaPadClearance } from "@tscircuit/checks"
import { getBoundsOfPcbElements } from "@tscircuit/circuit-json-util"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { originalOwners } from "./audit-retention-fixed-artifact"

type Json = any
type Token = { type: string; value: string }
type Proof = { tokens: Token[]; status: string; owners: string[] }
export type SourceOverlayInput = {
  originalSrjText: string
  originalTracesText: string
  sourceCircuitJsonText: string
  expectedInputSha256: string
  expectedTracesSha256: string
  expectedSourceSha256: string
  expectedSourceReference: string
  materializedVias: Json[]
  minClearance: number
}
const sha = (text: string): string => createHash("sha256").update(text).digest("hex")
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const positive = (value: unknown): value is number => finite(value) && value > 0
const key = (kind: string, value: string): string => JSON.stringify([kind, value])
const tokenKey = (token: Token): string => key(token.type, token.value)
const uniqueTokens = (tokens: Token[]): Token[] => [...new Map(tokens.map((token) => [tokenKey(token), token])).values()]

/** Validate fields that the pinned checker's broad and narrow phases actually read. */
const validatePadGeometry = (pad: Json): void => {
  assert(finite(pad.x) && finite(pad.y), "Nonfinite original pad center")
  let width: number, height: number, angle = 0, radius = 0
  assert(pad.route === undefined && pad.outline === undefined && pad.points === undefined, "Ambiguous alternate original pad bounds")
  assert(pad.center === undefined || pad.center?.x === pad.x && pad.center?.y === pad.y, "Contradictory original pad center")
  if (pad.type === "pcb_smtpad") {
    assert(["circle", "rect", "rotated_rect", "pill", "rotated_pill"].includes(pad.shape), "Unsupported original SMT shape")
    assert(typeof pad.layer === "string" && ["top", "inner1", "inner2", "bottom"].includes(pad.layer), "Unknown original SMT layer")
    if (pad.shape === "circle") {
      assert(positive(pad.radius), "Invalid original SMT radius")
      width = height = pad.radius * 2
      assert(pad.width === undefined || Math.abs(pad.width - width) <= 1e-9, "Contradictory original SMT circle width")
      assert(pad.height === undefined || Math.abs(pad.height - height) <= 1e-9, "Contradictory original SMT circle height")
    } else {
      assert(positive(pad.width) && positive(pad.height), "Invalid original SMT dimensions")
      width = pad.width; height = pad.height
      if (pad.shape.startsWith("rotated_")) {
        assert(finite(pad.ccw_rotation), "Missing original SMT rotation")
        angle = pad.ccw_rotation
      } else assert(pad.ccw_rotation === undefined || pad.ccw_rotation === 0, "Ambiguous unrotated SMT geometry")
      if (pad.shape.endsWith("pill")) {
        assert(positive(pad.radius) && Math.abs(pad.radius - Math.min(width, height) / 2) <= 1e-9, "Invalid original pill radius")
        radius = pad.radius
      } else {
        assert(pad.corner_radius === undefined || finite(pad.corner_radius) && pad.corner_radius >= 0, "Invalid rounded rectangle radius")
        radius = Math.min(pad.corner_radius ?? 0, width / 2, height / 2)
      }
    }
  } else {
    assert(pad.type === "pcb_plated_hole", "Expected original SMT or plated pad")
    assert(Array.isArray(pad.layers) && pad.layers.length > 0 && pad.layers.every((layer: string) => ["top", "inner1", "inner2", "bottom"].includes(layer)), "Unknown original plated layers")
    if (pad.shape === "circle") {
      assert(positive(pad.outer_diameter) && positive(pad.hole_diameter) && pad.hole_diameter <= pad.outer_diameter, "Invalid original plated circle")
      assert((pad.hole_offset_x ?? 0) === 0 && (pad.hole_offset_y ?? 0) === 0 && pad.rect_pad_width === undefined && pad.outer_width === undefined, "Ambiguous original plated circle bounds")
      width = height = pad.outer_diameter
    } else if (pad.shape === "pill") {
      assert(positive(pad.outer_width) && positive(pad.outer_height) && positive(pad.hole_width) && positive(pad.hole_height), "Invalid original plated pill")
      assert(pad.hole_width <= pad.outer_width && pad.hole_height <= pad.outer_height && finite(pad.ccw_rotation), "Invalid original plated pill envelope")
      assert(pad.rect_pad_width === undefined, "Ambiguous original plated pill geometry")
      width = pad.outer_width; height = pad.outer_height; angle = pad.ccw_rotation
      radius = Math.min(width, height) / 2
    } else {
      // Oval's checker broad phase is an ellipse while its narrow phase is a
      // capsule; it is deliberately not accepted as a complete contract here.
      assert(pad.shape === "circular_hole_with_rect_pad" && pad.pad_shape === "rect" && pad.hole_shape === "circle", "Unsupported original plated shape")
      assert(positive(pad.rect_pad_width) && positive(pad.rect_pad_height) && positive(pad.hole_diameter), "Invalid original rectangular plated pad")
      assert(finite(pad.hole_offset_x) && finite(pad.hole_offset_y) && finite(pad.rect_ccw_rotation), "Invalid original plated offset/rotation")
      width = pad.rect_pad_width; height = pad.rect_pad_height; angle = pad.rect_ccw_rotation
    }
  }
  assert(pad.rotation === undefined || finite(pad.rotation) && pad.rotation === angle, "Ambiguous original pad rotation")
  const bounds = getBoundsOfPcbElements([pad])
  assert([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(finite) && bounds.maxX >= bounds.minX && bounds.maxY >= bounds.minY, "Nonfinite original pad bounds")
  if (pad.shape === "circle") assert(Math.abs(bounds.minX - (pad.x - width / 2)) <= 1e-9 && Math.abs(bounds.maxX - (pad.x + width / 2)) <= 1e-9 &&
    Math.abs(bounds.minY - (pad.y - height / 2)) <= 1e-9 && Math.abs(bounds.maxY - (pad.y + height / 2)) <= 1e-9, "Ambiguous original circle checker body")
  const radians = angle * Math.PI / 180
  // The rounded core plus disk is contained by these extrema. For a pill the
  // short core dimension is zero. The index must enclose the actual checker body.
  const ex = Math.abs(Math.cos(radians)) * (width / 2 - radius) + Math.abs(Math.sin(radians)) * (height / 2 - radius) + radius
  const ey = Math.abs(Math.sin(radians)) * (width / 2 - radius) + Math.abs(Math.cos(radians)) * (height / 2 - radius) + radius
  assert(bounds.minX <= pad.x - ex + 1e-8 && bounds.maxX >= pad.x + ex - 1e-8 && bounds.minY <= pad.y - ey + 1e-8 && bounds.maxY >= pad.y + ey - 1e-8,
    "Original pad index bounds do not enclose the pinned checker body")
}

/** Supplemental same-checker/original-authored-geometry audit; never reroutes. */
export const auditOriginalSourceViaPadOverlay = (input: SourceOverlayInput): Json => {
  assert.equal(sha(input.originalSrjText), input.expectedInputSha256, "Original input provenance mismatch")
  assert.equal(sha(input.originalTracesText), input.expectedTracesSha256, "Captured trace provenance mismatch")
  assert.equal(sha(input.sourceCircuitJsonText), input.expectedSourceSha256, "Original source CJSON provenance mismatch")
  const original = JSON.parse(input.originalSrjText), traces = JSON.parse(input.originalTracesText), source = JSON.parse(input.sourceCircuitJsonText)
  assert.equal(original.sourceCircuitJson, input.expectedSourceReference, "Original source reference mismatch")
  assert.equal(original.layerCount, 4); assert.notEqual(original.allowBlindAndBuriedVias, true)
  assert(finite(input.minClearance) && input.minClearance >= 0, "Invalid explicit original via-pad rule")
  assert.equal(input.minClearance, original.minViaEdgeToPadEdgeClearance ?? 0.1, "Original via-pad rule changed")
  assert(Array.isArray(source) && Array.isArray(traces), "Invalid source/captured payload")
  const beforeSource = JSON.stringify(source), beforeVias = JSON.stringify(input.materializedVias)
  const owners = originalOwners(original)
  const parent = new Map<string, string>(), anchors = new Map<string, Token[]>()
  const find = (node: string): string => {
    if (!parent.has(node)) parent.set(node, node)
    const previous = parent.get(node)!
    if (previous !== node) parent.set(node, find(previous))
    return parent.get(node)!
  }
  const join = (nodes: string[]): void => {
    if (nodes.length < 2) { for (const node of nodes) find(node); return }
    const first = find(nodes[0]!)
    for (const node of nodes.slice(1)) { const other = find(node); if (other !== first) parent.set(other, first) }
  }
  const node = (kind: string, value: unknown): string => {
    assert(typeof value === "string" && value.length > 0, "Missing typed source identity")
    return key(kind, value)
  }
  const addAnchor = (identity: string, token: Token): void => {
    find(identity); anchors.set(identity, [...(anchors.get(identity) ?? []), token])
  }
  const definitionIds = new Set<string>()
  for (const element of source) {
    assert(typeof element.type === "string", "Missing original source element type")
    // Fabrication notes and old routed PCB objects do not participate in this
    // overlay. Their IDs cannot affect either ownership or the pad index.
    if (!element.type.startsWith("source_") && !["pcb_port", "pcb_component", "pcb_board", "pcb_smtpad", "pcb_plated_hole"].includes(element.type)) continue
    const primaryField = `${element.type}_id`
    if (typeof element[primaryField] === "string") {
      const definition = key(element.type, element[primaryField])
      assert(!definitionIds.has(definition), "Duplicate typed original source identity")
      definitionIds.add(definition)
    }
    if (element.type === "source_trace") {
      const id = node("source-trace", element.source_trace_id)
      join([id, ...(element.connected_source_port_ids ?? []).map((id: string) => node("source-port", id)),
        ...(element.connected_source_net_ids ?? []).map((id: string) => node("source-net", id))])
      addAnchor(id, { type: "source-trace", value: element.source_trace_id })
    } else if (element.type === "source_port") {
      const id = node("source-port", element.source_port_id)
      addAnchor(id, { type: "source-port", value: element.source_port_id })
    } else if (element.type === "source_net") {
      const id = node("source-net", element.source_net_id)
      addAnchor(id, { type: "source-net", value: element.source_net_id })
    } else if (element.type === "pcb_port") {
      const id = node("pcb-port", element.pcb_port_id)
      addAnchor(id, { type: "pcb-port", value: element.pcb_port_id })
      if (element.source_port_id) join([id, node("source-port", element.source_port_id)])
    } else if (element.type === "source_component") {
      for (const group of element.internally_connected_source_port_ids ?? []) join(group.map((id: string) => node("source-port", id)))
    } else if (element.type === "source_component_internal_connection") {
      join(element.source_port_ids.map((id: string) => node("source-port", id)))
    }
  }
  const componentTokens = new Map<string, Token[]>()
  for (const [id, tokens] of anchors) {
    const root = find(id); componentTokens.set(root, [...(componentTokens.get(root) ?? []), ...tokens])
  }
  const proof = (tokens: Token[]): Proof => {
    const unique = uniqueTokens(tokens)
    return { tokens: unique, ...owners.resolveTokens(unique) }
  }
  const pads = source.filter((element: Json) => element.type === "pcb_smtpad" || element.type === "pcb_plated_hole")
  const shapeCounts: Record<string, number> = {}
  const physicalIds = new Set<string>(), entities = new Map<string, Proof>(), overlayPads: Json[] = [], padShapeByOverlayId = new Map<string, string>()
  let directAnchoredPads = 0, sourceComponentAnchoredPads = 0, originalPhysicalIdAnchoredPads = 0, ambiguousPads = 0, unknownPads = 0
  for (const [index, pad] of pads.entries()) {
    validatePadGeometry(pad)
    shapeCounts[`${pad.type}:${pad.shape}`] = (shapeCounts[`${pad.type}:${pad.shape}`] ?? 0) + 1
    const field = pad.type === "pcb_smtpad" ? "pcb_smtpad_id" : "pcb_plated_hole_id"
    assert(typeof pad[field] === "string" && !physicalIds.has(pad[field]), "Duplicate or missing original physical pad identity")
    physicalIds.add(pad[field])
    const directTokens = pad.pcb_port_id ? [{ type: "pcb-port", value: pad.pcb_port_id }] : []
    const logicalTokens = pad.pcb_port_id && parent.has(key("pcb-port", pad.pcb_port_id))
      ? componentTokens.get(find(key("pcb-port", pad.pcb_port_id))) ?? [] : []
    const physicalField = pad.type === "pcb_smtpad" ? "pcb_smtpad_id" : "pcb_plated_hole_id"
    const originalPadTokens: Token[] = original.obstacles
      .filter((obstacle: Json) => obstacle.circuitJsonMetadata?.[physicalField] === pad[field])
      .flatMap((obstacle: Json) => owners.obstacle(obstacle).proof.map((encoded: string) => {
        const decoded = JSON.parse(encoded)
        assert(Array.isArray(decoded) && decoded.length === 2 && decoded.every((value: unknown) => typeof value === "string"), "Invalid original typed pad proof")
        return { type: decoded[0], value: decoded[1] }
      }))
    const combined = proof([...directTokens, ...logicalTokens, ...originalPadTokens])
    if (combined.status === "resolved") {
      if (proof(directTokens).status === "resolved") directAnchoredPads++
      else if (proof(logicalTokens).status === "resolved") sourceComponentAnchoredPads++
      else if (proof(originalPadTokens).status === "resolved") originalPhysicalIdAnchoredPads++
      else assert.fail("Resolved source pad lacks an explicit original owner anchor")
    } else if (combined.status === "ambiguous") ambiguousPads++
    else unknownPads++
    const id = `source-overlay:pad:${index}`
    entities.set(id, combined)
    padShapeByOverlayId.set(id, `${pad.type}:${pad.shape}${pad.corner_radius > 0 ? ":rounded" : ""}`)
    overlayPads.push({ ...structuredClone(pad), [field]: id })
  }
  const rawTraceById = new Map<string, Json>()
  for (const trace of traces) {
    assert(typeof trace.pcb_trace_id === "string" && !rawTraceById.has(trace.pcb_trace_id), "Duplicate captured trace identity")
    rawTraceById.set(trace.pcb_trace_id, trace)
  }
  const overlayVias: Json[] = [], seenViaIds = new Set<string>()
  const rawViaProofs: Array<{ x: number; y: number; proof: Proof }> = []
  for (const trace of traces) for (const point of trace.route) {
    if (point.route_type !== "via") continue
    assert([point.x, point.y].every(finite) && (point.via_diameter ?? 0.3) === 0.3 && (point.via_hole_diameter ?? 0.15) === 0.15, "Invalid captured via dimensions")
    const identity = proof([{ type: "connection-name", value: trace.connection_name },
      ...(trace.source_trace_id ? [{ type: "source-trace", value: trace.source_trace_id }] : [])])
    assert.equal(identity.status, "resolved", "Captured via original owner unresolved")
    rawViaProofs.push({ x: point.x, y: point.y, proof: identity })
  }
  for (const [index, via] of input.materializedVias.entries()) {
    assert(via.type === "pcb_via" && typeof via.pcb_via_id === "string" && !seenViaIds.has(via.pcb_via_id), "Duplicate or invalid materialized via identity")
    seenViaIds.add(via.pcb_via_id)
    assert([via.x, via.y].every(finite) && via.outer_diameter === 0.3 && via.hole_diameter === 0.15, "Invalid manufactured via dimensions/position")
    assert.deepEqual([...via.layers].sort(), ["bottom", "inner1", "inner2", "top"], "Via does not span the original four manufactured layers")
    assert(via.route === undefined && via.outline === undefined && via.points === undefined && via.center === undefined &&
      via.width === undefined && via.height === undefined && (via.rotation ?? 0) === 0 && (via.ccw_rotation ?? 0) === 0, "Ambiguous materialized via circle geometry")
    const viaBounds = getBoundsOfPcbElements([via])
    assert([viaBounds.minX, viaBounds.minY, viaBounds.maxX, viaBounds.maxY].every(finite) &&
      Math.abs(viaBounds.minX - (via.x - 0.15)) <= 1e-9 && Math.abs(viaBounds.maxX - (via.x + 0.15)) <= 1e-9 &&
      Math.abs(viaBounds.minY - (via.y - 0.15)) <= 1e-9 && Math.abs(viaBounds.maxY - (via.y + 0.15)) <= 1e-9, "Nonfinite or ambiguous output via geometry")
    const trace = rawTraceById.get(via.pcb_trace_id)
    assert(trace, "Materialized via lacks a unique captured trace")
    assert(trace.route.some((point: Json) => point.route_type === "via" && point.x === via.x && point.y === via.y), "Materialized via is not present in captured trace")
    const viaProof = proof([{ type: "connection-name", value: trace.connection_name },
      ...(trace.source_trace_id ? [{ type: "source-trace", value: trace.source_trace_id }] : [])])
    assert.equal(viaProof.status, "resolved", "Captured via original typed owner unresolved")
    const id = `source-overlay:via:${index}`
    entities.set(id, viaProof)
    overlayVias.push({ ...structuredClone(via), pcb_via_id: id })
  }
  for (const raw of rawViaProofs) {
    assert(overlayVias.some((via) => via.x === raw.x && via.y === raw.y &&
      owners.resolveTokens([...raw.proof.tokens, ...entities.get(via.pcb_via_id)!.tokens]).status === "resolved"),
      "Materialized vias omit an original-owned captured physical site")
  }
  const connMap = new ConnectivityMap({})
  connMap.areIdsConnected = (first: string, second: string): boolean => {
    const a = entities.get(first), b = entities.get(second)
    if (!a || !b || a.status !== "resolved" || b.status !== "resolved") return false
    // Joint typed-root resolution avoids display-label collisions such as
    // merged original names a+b versus the unrelated literal name "a|b".
    return owners.resolveTokens([...a.tokens, ...b.tokens]).status === "resolved"
  }
  const declarations = source.filter((element: Json) => element.type.startsWith("source_") ||
    ["pcb_port", "pcb_component", "pcb_board"].includes(element.type)).map((element: Json) => structuredClone(element))
  const overlay = [...declarations, ...overlayPads, ...overlayVias]
  assert(!overlay.some((element: Json) => element.type === "pcb_trace"), "Original routed traces leaked into overlay")
  const errors: Json[] = checkViaPadClearance(overlay, { connMap, minClearance: input.minClearance })
  let confirmedForeignViolations = 0, unknownNearContacts = 0
  const unknownReasons: Record<string, number> = {}, confirmedForeignFindingsByPadShape: Record<string, number> = {}, unknownNearFindingsByPadShape: Record<string, number> = {}
  for (const error of errors) {
    assert(finite(error.actual_clearance) && finite(error.minimum_clearance) && error.minimum_clearance === input.minClearance, "Nonfinite or changed checker clearance")
    assert(error.center && finite(error.center.x) && finite(error.center.y), "Nonfinite checker contact center")
    assert(error.type === "pcb_pad_pad_clearance_error" && Array.isArray(error.pcb_pad_ids) && error.pcb_pad_ids.length === 2, "Unexpected checker error contract")
    const padShape = padShapeByOverlayId.get(error.pcb_pad_ids[1])
    assert(padShape, "Checker error lacks original pad shape identity")
    const [first, second] = error.pcb_pad_ids.map((id: string) => entities.get(id))
    assert(first && second, "Checker returned an unbound overlay identity")
    if (first.status === "resolved" && second.status === "resolved") {
      assert.equal(owners.resolveTokens([...first.tokens, ...second.tokens]).status, "ambiguous", "Checker reported a strict same-owner pair")
      confirmedForeignViolations++
      confirmedForeignFindingsByPadShape[padShape] = (confirmedForeignFindingsByPadShape[padShape] ?? 0) + 1
    } else {
      unknownNearContacts++
      unknownNearFindingsByPadShape[padShape] = (unknownNearFindingsByPadShape[padShape] ?? 0) + 1
      const reason = second.status === "ambiguous" ? "SOURCE_COMPONENT_MAPS_TO_MULTIPLE_ORIGINAL_OWNERS" : "SOURCE_PAD_OWNER_UNANCHORED"
      unknownReasons[reason] = (unknownReasons[reason] ?? 0) + 1
    }
  }
  assert.equal(JSON.stringify(source), beforeSource, "Original source data mutated")
  assert.equal(JSON.stringify(input.materializedVias), beforeVias, "Actual output via payload mutated")
  return { status: unknownNearContacts ? "UNKNOWN_NEAR_SOURCE_OWNER_CONTACTS" : confirmedForeignViolations ? "CONFIRMED_FOREIGN_ORIGINAL_OWNER_VIOLATIONS" : "PASS_SAME_CHECKER_ORIGINAL_SOURCE_GEOMETRY",
    scope: "Supplemental SAME pinned checkViaPadClearance on original-authored source pad geometry and actual materialized new vias; not an independent geometry algorithm or mandatory-validator replacement",
    inputSha256: input.expectedInputSha256, tracesSha256: input.expectedTracesSha256, sourceCircuitJsonSha256: input.expectedSourceSha256,
    sourcePadCount: pads.length, materializedViaObjects: overlayVias.length, directAnchoredPads, sourceComponentAnchoredPads, originalPhysicalIdAnchoredPads,
    validatedSourceShapeCounts: shapeCounts, confirmedForeignFindingsByPadShape, unknownNearFindingsByPadShape,
    ambiguousPadOwners: ambiguousPads, unanchoredPadOwners: unknownPads, checkerErrorCount: errors.length,
    confirmedForeignViolationCount: confirmedForeignViolations, unknownNearContactCount: unknownNearContacts, unknownReasons,
    errorCountUnit: "Materialized via-object/pad checker errors, not deduplicated manufactured physical-site counts",
    clearanceMm: input.minClearance, epsilonMm: 0.005, sourceDataUnchanged: true, actualOutputViaPayloadUnchanged: true,
    viaPadRulePassed: unknownNearContacts ? null : confirmedForeignViolations === 0,
    limits: "No original source PCB traces/vias participate. Same-owner waivers require joint strict original typed-root proof; logical source components never merge original owners. Unsupported/nonfinite geometry fails before checking. This is only the via-to-pad rule on authored source geometry; drill/trace/board rules remain separate." }
}
