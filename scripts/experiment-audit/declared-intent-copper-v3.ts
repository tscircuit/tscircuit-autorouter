import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"

type Json = Record<string, any>
type Owner = { status: "RESOLVED"; owner: string; anchors: string[] } |
  { status: "UNKNOWN" | "AMBIGUOUS"; reason: string }
type Input = { original: Json; pointPairs: Json; traces: Json[]; circuitJson: Json[] }
type CheckName = "viaPad" | "padTrace" | "viaTrace" | "traceOverlap" | "differentNetViaSpacing" | "sameNetViaSpacing" | "padPad"
type GeometryChecker = (circuit: Json[], options: { connMap: any; minClearance?: number }) => Json[]
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value
const digest = (value: any): string => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex")
const token = (kind: string, id: string): string => JSON.stringify([kind, id])
const strings = (values: any[]): string[] => [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))]
const unknown = (reason: string): Owner => ({ status: "UNKNOWN", reason })

class IntentOwners {
  private parents = new Map<string, string>()
  private aliases = new Map<string, Set<string>>()
  private anchors = new Map<string, string>()
  private pointPairAliases = new Map<string, Owner[]>()
  private connectionTokens = new Map<string, string[]>()
  private originalTokens: string[] = []

  constructor(original: Json, pointPairs: Json) {
    if (!Array.isArray(original.connections)) throw new Error("Original connection declarations are required")
    for (const [index, connection] of original.connections.entries()) {
      if (typeof connection.name !== "string") throw new Error("Original connection lacks an explicit name")
      const connectionToken = token("original-connection", JSON.stringify([index, connection.name]))
      this.originalTokens.push(connectionToken)
      const declarations = this.connectionTokens.get(connection.name) ?? []
      declarations.push(connectionToken)
      this.connectionTokens.set(connection.name, declarations)
      this.ensure(connectionToken)
      this.anchors.set(connectionToken, `${index}:${connection.name}`)
      this.alias(connection.name, connectionToken)
    }
    for (const [index, connection] of original.connections.entries()) {
      const root = this.originalTokens[index]
      for (const id of strings([connection.__netConnectionName, connection.netConnectionName])) this.link(root, "net", id)
      for (const id of strings([connection.rootConnectionName, ...(connection.__rootConnectionNames ?? []), ...(connection.mergedConnectionNames ?? [])])) {
        this.link(root, "root", id)
        const references = this.connectionTokens.get(id) ?? []
        if (references.length === 1) this.union(root, references[0])
      }
      for (const id of strings([connection.source_trace_id])) this.link(root, "source", id)
      for (const point of connection.pointsToConnect ?? []) {
        if (typeof point.pcb_port_id === "string") this.link(root, "port", point.pcb_port_id)
        if (typeof point.pointId === "string") this.link(root, "point", point.pointId)
      }
    }
    // Point-pair provenance may resolve an alias, but never joins distinct original owners.
    for (const connection of pointPairs.connections ?? []) {
      const explicit = strings([connection.__netConnectionName, connection.netConnectionName,
        connection.rootConnectionName, ...(connection.__rootConnectionNames ?? []), ...(connection.mergedConnectionNames ?? []), connection.source_trace_id])
      const roots = explicit.map((id) => this.originalReference(id))
      const direct = typeof connection.name === "string" ? this.originalReference(connection.name) : unknown("Missing point-pair name")
      const owner = roots.some((candidate) => candidate.status === "UNKNOWN")
        ? unknown("At least one explicit point-pair root is absent from original intent")
        : this.combine([direct, ...roots], "Point-pair roots do not resolve an original owner")
      if (typeof connection.name === "string") {
        const list = this.pointPairAliases.get(connection.name) ?? []
        list.push(owner)
        this.pointPairAliases.set(connection.name, list)
      }
    }
  }

  private ensure(id: string): void { if (!this.parents.has(id)) this.parents.set(id, id) }
  private find(id: string): string {
    this.ensure(id)
    const parent = this.parents.get(id)!
    if (parent === id) return id
    const root = this.find(parent)
    this.parents.set(id, root)
    return root
  }
  private union(left: string, right: string): void {
    const a = this.find(left), b = this.find(right)
    if (a !== b) this.parents.set(b, a)
  }
  private alias(id: string, typed: string): void {
    const group = this.aliases.get(id) ?? new Set<string>()
    group.add(typed)
    this.aliases.set(id, group)
  }
  private link(root: string, kind: string, id: string): void {
    const typed = token(kind, id)
    this.alias(id, typed)
    this.union(root, typed)
  }
  private typed(id: string): Owner {
    if (!this.parents.has(id)) return unknown("Identity is absent from original declarations")
    const root = this.find(id)
    const anchors = [...this.anchors].filter(([candidate]) => this.find(candidate) === root).map(([, name]) => name).sort()
    if (anchors.length === 0) return unknown("Identity has no original connection anchor")
    return { status: "RESOLVED", owner: `intent-owner:${digest(anchors)}`, anchors }
  }
  combine(owners: Owner[], absent: string): Owner {
    if (owners.some((owner) => owner.status === "AMBIGUOUS")) return { status: "AMBIGUOUS", reason: "Conflicting declared owner references" }
    const known = owners.filter((owner): owner is Extract<Owner, { status: "RESOLVED" }> => owner.status === "RESOLVED")
    if (new Set(known.map((owner) => owner.owner)).size > 1) return { status: "AMBIGUOUS", reason: "Distinct original owners resolve the same item" }
    return known[0] ?? unknown(absent)
  }
  originalReference(id: string): Owner {
    return this.combine([...(this.aliases.get(id) ?? [])].map((typed) => this.typed(typed)), "Reference is absent from original connection/net/terminal declarations")
  }
  traceReference(id: unknown): Owner {
    if (typeof id !== "string") return unknown("Raw trace lacks connection_name")
    return this.combine([this.originalReference(id), ...(this.pointPairAliases.get(id) ?? [])], "Raw trace connection_name has no explicit original or point-pair root owner")
  }
  port(id: unknown): Owner {
    return typeof id === "string" ? this.typed(token("port", id)) : unknown("No original PCB-port identity")
  }
  obstacle(obstacle: Json): Owner {
    const meta = obstacle.circuitJsonMetadata ?? {}
    return this.combine([...(obstacle.connectedTo ?? []).map((id: string) => this.originalReference(id)), this.port(meta.pcb_port_id)],
      "Original obstacle lacks a resolved declared owner")
  }
}

function padGeometry(pad: Json): string | undefined {
  const layers = strings(pad.type === "pcb_smtpad" ? [pad.layer] : pad.layers ?? []).sort()
  if (layers.length === 0 || ![pad.x, pad.y].every(Number.isFinite)) return undefined
  let shape: any
  if (pad.shape === "circle") {
    const radius = pad.type === "pcb_smtpad" ? pad.radius ?? pad.width / 2 : pad.outer_diameter / 2
    if (!Number.isFinite(radius) || radius <= 0) return undefined
    shape = ["circle", radius]
  } else if (pad.type === "pcb_smtpad" && ["rect", "rotated_rect"].includes(pad.shape)) {
    shape = ["rect", pad.width, pad.height, pad.ccw_rotation ?? 0]
  } else if (pad.type === "pcb_plated_hole" && Number.isFinite(pad.rect_pad_width) && Number.isFinite(pad.rect_pad_height)) {
    shape = ["rect", pad.rect_pad_width, pad.rect_pad_height, pad.rect_ccw_rotation ?? 0]
  } else return undefined
  if (shape[0] === "rect" && (!shape.slice(1).every(Number.isFinite) || shape[1] <= 0 || shape[2] <= 0)) return undefined
  return JSON.stringify([pad.type, pad.x, pad.y, layers, shape])
}

function obstaclePadProjection(obstacle: Json, index: number): { geometry?: string; aliases: string[] } {
  const meta = obstacle.circuitJsonMetadata ?? {}
  if (obstacle.isNonPlatedHole || meta.pcb_via_id) return { aliases: [] }
  const layers = strings(obstacle.layers ?? []).filter((layer) => /^(top|bottom|inner[1-8])$/.test(layer))
  if (!obstacle.center || ![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height].every(Number.isFinite) || layers.length === 0)
    return { aliases: [] }
  if (obstacle.width <= 0 || obstacle.height <= 0) return { aliases: [] }
  const { x, y } = obstacle.center
  const multi = !!meta.pcb_plated_hole_id || layers.length > 1
  const sourcePad = meta.source_component_name && meta.source_port_name ? obstacle.obstacleId ?? `${meta.source_component_name}.${meta.source_port_name}` : undefined
  const base = multi ? meta.pcb_plated_hole_id ?? `pcb_plated_hole_${x.toFixed(3)}_${y.toFixed(3)}` :
    meta.pcb_smtpad_id ?? sourcePad ?? `pcb_smtpad_${x.toFixed(3)}_${y.toFixed(3)}`
  const pad: Json = { type: multi ? "pcb_plated_hole" : "pcb_smtpad", x, y,
    ...(multi ? { layers } : { layer: layers[0] }) }
  const rotated = Number.isFinite(obstacle.ccwRotationDegrees)
  if (multi) {
    if (!rotated && Math.abs(obstacle.width - obstacle.height) < 0.001) {
      Object.assign(pad, { shape: "circle", outer_diameter: Math.max(obstacle.width, obstacle.height) })
    } else Object.assign(pad, { shape: "rect", rect_pad_width: obstacle.width,
      rect_pad_height: obstacle.height, rect_ccw_rotation: obstacle.ccwRotationDegrees ?? 0 })
  } else if (obstacle.shape === "circle") Object.assign(pad, { shape: "circle", radius: obstacle.width / 2 })
  else Object.assign(pad, { shape: rotated ? "rotated_rect" : "rect", width: obstacle.width,
    height: obstacle.height, ccw_rotation: obstacle.ccwRotationDegrees ?? 0 })
  return { geometry: padGeometry(pad), aliases: [String(base), `${base}_fragment_${index}`] }
}

export function checkDeclaredIntentViaPad(input: Input, checkerOrSuite: GeometryChecker | Partial<Record<CheckName, GeometryChecker>>): Json {
  const suite: Partial<Record<CheckName, GeometryChecker>> = typeof checkerOrSuite === "function" ? { viaPad: checkerOrSuite } : checkerOrSuite
  if (typeof suite.viaPad !== "function") throw new Error("Pinned via-pad checker is required")
  if (!Array.isArray(input.circuitJson) || !Array.isArray(input.traces)) throw new Error("Canonical circuit and raw traces must be arrays")
  const stackSupported = Number.isSafeInteger(input.original.layerCount) && input.original.layerCount >= 1 && input.original.layerCount <= 10
  const stackLayers = stackSupported ? (input.original.layerCount === 1 ? ["top"] :
    ["top", ...Array.from({ length: input.original.layerCount - 2 }, (_, i) => `inner${i + 1}`), "bottom"]) : []
  const allowedLayers = new Set(stackLayers)
  const layerSupported = (layer: unknown): boolean => typeof layer === "string" && allowedLayers.has(layer)
  const layerListSupported = (layers: unknown): layers is string[] => Array.isArray(layers) && layers.length > 0 &&
    new Set(layers).size === layers.length && layers.every(layerSupported)
  const viaSpanSupported = (layers: unknown): boolean => {
    if (!layerListSupported(layers)) return false
    const indices = layers.map((layer) => stackLayers.indexOf(layer)).sort((a, b) => a - b)
    if (input.original.allowBlindAndBuriedVias !== true) return layers.length === stackLayers.length
    return indices.at(-1)! - indices[0] + 1 === indices.length
  }
  const owners = new IntentOwners(input.original, input.pointPairs)
  const replaced = new Set(input.traces.map((trace) => trace.__replaces_pcb_trace_id).filter(Boolean))
  const rawTraces = [...(input.original.traces ?? []).filter((trace: Json) => !replaced.has(trace.pcb_trace_id)), ...input.traces]
  const traceOwners = new Map<string, Owner[]>()
  for (const trace of rawTraces) {
    if (typeof trace.pcb_trace_id !== "string") continue
    const list = traceOwners.get(trace.pcb_trace_id) ?? []
    list.push(owners.traceReference(trace.connection_name))
    traceOwners.set(trace.pcb_trace_id, list)
  }
  const obstacles = (input.original.obstacles ?? []).map((obstacle: Json, index: number) =>
    ({ obstacle, originalIndex: index, owner: owners.obstacle(obstacle), ...obstaclePadProjection(obstacle, index) }))
  const transformed = structuredClone(input.circuitJson)
  const identities = new Map<string, Json>()
  const representedObstacles = new Set<number>()
  const viaOwners: Json[] = [], padOwners: Json[] = [], traceOwnerRecords: Json[] = []
  for (const [index, element] of transformed.entries()) {
    if (!["pcb_via", "pcb_smtpad", "pcb_plated_hole", "pcb_trace"].includes(element.type)) continue
    const field = element.type === "pcb_via" ? "pcb_via_id" : element.type === "pcb_trace" ? "pcb_trace_id" : element.type === "pcb_smtpad" ? "pcb_smtpad_id" : "pcb_plated_hole_id"
    const originalId = element[field]
    let owner: Owner
    let mapping: string
    if (element.type === "pcb_trace") {
      const candidates = traceOwners.get(originalId) ?? []
      const supported = Array.isArray(element.route) && element.route.every((point: Json) =>
        point && [point.x, point.y].every(Number.isFinite) &&
        (point.route_type === "via" ? layerSupported(point.from_layer) && layerSupported(point.to_layer) &&
          point.from_layer !== point.to_layer && (point.layers === undefined || viaSpanSupported(point.layers)) :
          point.route_type === "wire" && layerSupported(point.layer) && Number.isFinite(point.width) && point.width > 0))
      owner = !supported ? unknown("Unsupported or invalid canonical trace geometry") :
        candidates.some((candidate) => candidate.status === "UNKNOWN")
          ? unknown("Canonical raw trace ID includes an unresolved owner declaration")
          : owners.combine(candidates, "Canonical trace ID has no actual raw connection_name owner")
      mapping = "actual canonical pcb_trace_id -> raw trace connection_name -> original declarations"
    } else if (element.type === "pcb_via") {
      const candidates = traceOwners.get(element.pcb_trace_id) ?? []
      const viaGeometryValid = [element.x, element.y, element.outer_diameter, element.hole_diameter].every(Number.isFinite) &&
        element.outer_diameter > 0 && element.hole_diameter > 0 && element.hole_diameter <= element.outer_diameter &&
        viaSpanSupported(element.layers)
      owner = !viaGeometryValid ? unknown("Invalid or unsupported canonical via geometry") :
        candidates.some((candidate) => candidate.status === "UNKNOWN")
          ? unknown("Actual raw pcb_trace_id includes an unresolved owner declaration")
          : owners.combine(candidates, "Canonical via lacks a unique actual raw pcb_trace_id owner")
      mapping = "actual canonical via pcb_trace_id -> raw trace connection_name -> original declarations"
    } else {
      const geometry = padGeometry(element)
      const matching = obstacles.filter((candidate: Json) => candidate.geometry !== undefined && candidate.geometry === geometry && candidate.aliases.includes(originalId))
      for (const candidate of matching) representedObstacles.add(candidate.originalIndex)
      const candidates: Owner[] = matching.map((candidate: Json) => candidate.owner)
      // A canonical port association cannot turn an unowned obstacle into owned copper.
      if (matching.length > 0 && candidates.some((candidate) => candidate.status === "RESOLVED")) candidates.push(owners.port(element.pcb_port_id))
      const padLayersSupported = element.type === "pcb_smtpad" ? layerSupported(element.layer) : layerListSupported(element.layers)
      owner = !padLayersSupported ? unknown("Canonical pad layers are missing or outside the original declared stack") :
        matching.some((candidate: Json) => candidate.owner.status === "UNKNOWN")
          ? unknown("At least one matching original obstacle has unresolved ownership")
          : owners.combine(candidates, geometry === undefined ? "Unsupported canonical pad copper geometry" : "No exact original obstacle identity/geometry with a declared owner")
      mapping = "original obstacle pad-id/fragment alias + exact original pad geometry; original declared owner only"
    }
    const typedId = token(element.type, String(index))
    element[field] = typedId
    const record = { canonicalIndex: index, type: element.type, originalId: originalId ?? null,
      typedId, ...(element.type === "pcb_via" ? { pcbTraceId: element.pcb_trace_id ?? null } : {}), ...owner, mapping }
    identities.set(typedId, record)
    if (element.type === "pcb_via") viaOwners.push(record)
    else if (element.type === "pcb_trace") traceOwnerRecords.push(record)
    else padOwners.push(record)
  }
  for (const via of viaOwners) {
    const candidates = traceOwnerRecords.filter((trace) => trace.originalId === via.pcbTraceId)
    const element = transformed[via.canonicalIndex]
    if (candidates.length === 0) {
      Object.assign(via, unknown("Canonical via has no actual canonical PCB trace link"))
      delete via.owner
      delete via.anchors
      element.pcb_trace_id = token("missing-canonical-trace", String(via.pcbTraceId))
    } else element.pcb_trace_id = candidates[0].typedId
  }
  // Fresh typed identities prevent accidental raw namespace collisions. This map
  // implements only intended-owner equivalence; it never reads source_trace edges.
  const trustedMap = {
    areIdsConnected(left: string, right: string): boolean {
      const a = identities.get(left), b = identities.get(right)
      return !!a && !!b && a.status === "RESOLVED" && b.status === "RESOLVED" && a.owner === b.owner
    },
  }
  for (const key of ["minViaEdgeToPadEdgeClearance", "minPadEdgeToPadEdgeClearance", "minTraceToPadEdgeClearance", "minViaHoleEdgeToViaHoleEdgeClearance"]) {
    if (input.original[key] !== undefined && (!Number.isFinite(input.original[key]) || input.original[key] < 0))
      throw new Error(`Invalid original declared clearance: ${key}`)
  }
  const minimums = [input.original.minViaEdgeToPadEdgeClearance, input.original.minPadEdgeToPadEdgeClearance]
    .filter((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
  const minClearance = minimums.length ? Math.max(...minimums) : undefined
  const checkMinimums: Partial<Record<CheckName, number | undefined>> = {
    viaPad: minClearance,
    padTrace: input.original.minTraceToPadEdgeClearance,
    viaTrace: input.original.minTraceToPadEdgeClearance,
    traceOverlap: input.original.minTraceToPadEdgeClearance,
    padPad: input.original.minPadEdgeToPadEdgeClearance,
    differentNetViaSpacing: input.original.minViaHoleEdgeToViaHoleEdgeClearance,
    sameNetViaSpacing: input.original.minViaHoleEdgeToViaHoleEdgeClearance,
  }
  const allFindings: Json[] = [], checks: Json = {}
  for (const [checkClass, checker] of Object.entries(suite)) {
    if (typeof checker !== "function") throw new Error(`Missing pinned predicate ${checkClass}`)
    // This published predicate also checks holes/keepouts. Those remain covered
    // by original screens; this additive invocation is scoped to copper pairs.
    const checkInput = structuredClone(checkClass === "traceOverlap" ?
      transformed.filter((element) => !["pcb_hole", "pcb_keepout"].includes(element.type)) : transformed)
    const errors = checker(checkInput, { connMap: trustedMap, minClearance: checkMinimums[checkClass as CheckName] })
    const findings = errors.map((error) => {
      const ids = new Set<string>()
      for (const [key, value] of Object.entries(error)) {
        if (/^pcb_(trace|pad|via|smtpad|plated_hole)_(id|ids)$/.test(key)) {
          for (const id of Array.isArray(value) ? value : [value]) if (typeof id === "string" && identities.has(id)) ids.add(id)
        }
        if ((key.endsWith("error_id") || key === "pcb_error_id") && typeof value === "string") {
          for (const id of identities.keys()) if (value.includes(id)) ids.add(id)
        }
      }
      const members = [...ids].map((id) => identities.get(id)!)
      const resolved = members.length > 0 && members.every((member) => member.status === "RESOLVED")
      const foreign = resolved && new Set(members.map((member) => member.owner)).size > 1
      const rawError = structuredClone(error)
      for (const [key, value] of Object.entries(rawError)) {
        if (/^pcb_(trace|pad|via|smtpad|plated_hole)_(id|ids)$/.test(key)) {
          rawError[key] = Array.isArray(value) ? value.map((id) => identities.get(id)?.originalId ?? id) : identities.get(value as string)?.originalId ?? value
        }
      }
      const classification = !resolved ? "UNKNOWN_OWNER_COPPER" : foreign ? "DECLARED_FOREIGN_COPPER" : "SUPPORTED_SAME_OWNER_RULE"
      return { checkClass, classification, canonicalIndexes: members.map((member) => member.canonicalIndex),
        owners: members.map((member) => ({ type: member.type, id: member.originalId, status: member.status,
          owner: member.owner ?? null, reason: member.reason ?? null })), error: rawError }
    })
    checks[checkClass] = { count: findings.length,
      knownForeignFindingCount: findings.filter((finding) => finding.classification === "DECLARED_FOREIGN_COPPER").length,
      unknownFindingCount: findings.filter((finding) => finding.classification === "UNKNOWN_OWNER_COPPER").length,
      sameOwnerRuleFindingCount: findings.filter((finding) => finding.classification === "SUPPORTED_SAME_OWNER_RULE").length,
      appliedMinClearance: checkMinimums[checkClass as CheckName] ?? null, findings }
    allFindings.push(...findings)
  }
  const knownForeignFindingCount = checks.viaPad.knownForeignFindingCount
  const unknownFindingCount = checks.viaPad.unknownFindingCount
  const knownForeignCopperFindingCount = allFindings.filter((finding) => finding.classification === "DECLARED_FOREIGN_COPPER").length
  const unknownCopperFindingCount = allFindings.filter((finding) => finding.classification === "UNKNOWN_OWNER_COPPER").length
  const definiteCopperRuleFindingCount = allFindings.length - unknownCopperFindingCount
  const unknownViaCount = viaOwners.filter((owner) => owner.status !== "RESOLVED").length
  const unknownTraceCount = traceOwnerRecords.filter((owner) => owner.status !== "RESOLVED").length
  const unknownPadCount = padOwners.filter((owner) => owner.status !== "RESOLVED").length
  const unmappedOriginalObstacles = obstacles.filter((candidate: Json) => !candidate.obstacle.isNonPlatedHole &&
    !candidate.obstacle.circuitJsonMetadata?.pcb_via_id && !representedObstacles.has(candidate.originalIndex))
  const unmappedDeclaredCopper = unmappedOriginalObstacles.filter((candidate: Json) => {
    const meta = candidate.obstacle.circuitJsonMetadata ?? {}
    return !!(meta.pcb_smtpad_id || meta.pcb_plated_hole_id || meta.pcb_port_id ||
      (meta.source_component_name && meta.source_port_name))
  })
  const coverageUnknown = !stackSupported || unknownViaCount + unknownPadCount + unknownTraceCount + unmappedDeclaredCopper.length > 0
  const status = knownForeignFindingCount > 0 ? "FAIL_FOREIGN_CLEARANCE" : knownForeignCopperFindingCount > 0 ? "FAIL_FOREIGN_COPPER" :
    definiteCopperRuleFindingCount > 0 ? "FAIL_SUPPORTED_COPPER_RULE" : coverageUnknown || unknownCopperFindingCount > 0 ? "UNKNOWN_OWNERSHIP" : "PASS"
  const unknownOwnerReasonCounts: Record<string, number> = {}
  for (const item of [...viaOwners, ...padOwners, ...traceOwnerRecords].filter((item) => item.status !== "RESOLVED")) {
    const reason = `${item.status}:${item.reason}`
    unknownOwnerReasonCounts[reason] = (unknownOwnerReasonCounts[reason] ?? 0) + 1
  }
  const geometryOnly = (elements: Json[]): Json[] => elements.filter((e) => ["pcb_via", "pcb_smtpad", "pcb_plated_hole", "pcb_trace"].includes(e.type)).map((e) =>
    Object.fromEntries(Object.entries(e).filter(([key]) => !key.endsWith("_id") && !key.endsWith("_ids"))))
  const beforeGeometry = digest(geometryOnly(input.circuitJson)), afterGeometry = digest(geometryOnly(transformed))
  if (beforeGeometry !== afterGeometry) throw new Error("Offline checker changed copper geometry")
  const allPublishedCopperChecksRun = ["viaPad", "padTrace", "viaTrace", "traceOverlap", "differentNetViaSpacing", "sameNetViaSpacing", "padPad"].every((name) => checks[name] !== undefined)
  return { schemaVersion: 2, status, qualifiedPhysicalClean: status === "PASS" && allPublishedCopperChecksRun,
    qualifiedSupportedCopper: status === "PASS" && allPublishedCopperChecksRun, allPublishedCopperChecksRun,
    ownershipCoverageStatus: coverageUnknown ? "UNKNOWN" : "COMPLETE", knownForeignFindingCount, unknownFindingCount,
    unknownViaCount, unknownPadCount, unknownTraceCount, unknownOwnerReasonCounts, viaCount: viaOwners.length, padCount: padOwners.length, traceCount: traceOwnerRecords.length,
    knownForeignCopperFindingCount, unknownCopperFindingCount, definiteCopperRuleFindingCount, checksRun: Object.keys(checks), checks,
    appliedMinClearance: minClearance ?? null,
    clearanceSource: minClearance === undefined ? "PINNED_CHECKER_BOARD_OR_DEFAULT" : "MAXIMUM_ORIGINAL_DECLARED_VIA_PAD_AND_PAD_PAD_CLEARANCE", findings: checks.viaPad.findings, allFindings, viaOwners, padOwners, traceOwners: traceOwnerRecords,
    originalObstacleCoverage: { originalCount: obstacles.length, representedCount: representedObstacles.size,
      unmappedCount: unmappedOriginalObstacles.length, unmappedDeclaredCopperCount: unmappedDeclaredCopper.length,
      unmappedDeclaredCopper: unmappedDeclaredCopper.map((candidate: Json) => ({ originalIndex: candidate.originalIndex,
        declaredIds: candidate.aliases, ownerStatus: candidate.owner.status })),
      genericUnmappedObstacleScope: "Generic SRJ obstacle rectangles without typed copper provenance are reported as unmapped; they are not silently invented as manufactured pads." },
    canonicalSemanticSha256: digest(input.circuitJson), copperGeometrySha256: beforeGeometry,
    originalStackSupported: stackSupported, supportedStackLayers: stackLayers,
    geometryUnchanged: true,
    scope: "Additive offline declared-intent copper predicates only; board/hole and official validation remain unchanged. Predicates use pinned published geometry; each class reports findings without deduplicating cross-class duplicates. No routing or geometry optimization. All unresolved or ambiguous owners and missing explicit original copper prevent PASS. This is not a proof of unsupported manufacturing/electrical rules.",
  }
}

export async function runDeclaredIntentCli(directory: string, runtimeRoot: string): Promise<Json> {
  const filenames = ["original-input.json", "point-pair-context.json", "raw-new-traces.json", "canonical-circuit-json.json"]
  const parsed: any[] = [], inputHashes: Json = {}
  for (const filename of filenames) {
    const bytes = readFileSync(join(directory, filename))
    inputHashes[filename] = createHash("sha256").update(new Uint8Array(bytes)).digest("hex")
    parsed.push(JSON.parse(bytes.toString("utf8")))
  }
  const require = createRequire(resolve(runtimeRoot, "package.json"))
  const checkerPath = require.resolve("@tscircuit/checks")
  const checkerPackage = require.resolve("@tscircuit/checks/package.json")
  const module = await import(pathToFileURL(checkerPath).href)
  const exports = { viaPad: "checkViaPadClearance", padTrace: "checkPadTraceClearance", viaTrace: "checkViaTraceClearance",
    traceOverlap: "checkEachPcbTraceNonOverlapping", differentNetViaSpacing: "checkDifferentNetViaSpacing",
    sameNetViaSpacing: "checkSameNetViaSpacing", padPad: "checkPadPadClearance" }
  const suite: Partial<Record<CheckName, GeometryChecker>> = {}
  for (const [name, exported] of Object.entries(exports)) {
    if (typeof module[exported] !== "function") throw new Error(`Pinned published checker is missing ${exported}`)
    suite[name as CheckName] = module[exported]
  }
  const result = checkDeclaredIntentViaPad({ original: parsed[0], pointPairs: parsed[1], traces: parsed[2], circuitJson: parsed[3] }, suite)
  result.inputHashes = inputHashes
  result.checker = { package: "@tscircuit/checks", exports, version: JSON.parse(readFileSync(checkerPackage, "utf8")).version,
    moduleSha256: createHash("sha256").update(new Uint8Array(readFileSync(checkerPath))).digest("hex") }
  result.sidecarSourceSha256 = createHash("sha256").update(new Uint8Array(readFileSync(new URL(import.meta.url)))).digest("hex")
  const output = join(directory, "declared-intent-via-pad.json")
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n")
  return { status: result.status, knownForeignFindingCount: result.knownForeignFindingCount,
    unknownFindingCount: result.unknownFindingCount, knownForeignCopperFindingCount: result.knownForeignCopperFindingCount,
    definiteCopperRuleFindingCount: result.definiteCopperRuleFindingCount, unknownCopperFindingCount: result.unknownCopperFindingCount,
    unknownViaCount: result.unknownViaCount, unknownTraceCount: result.unknownTraceCount,
    unknownPadCount: result.unknownPadCount,
    unmappedDeclaredCopperCount: result.originalObstacleCoverage.unmappedDeclaredCopperCount,
    geometryUnchanged: true, inputHashes, output }
}

if (import.meta.main) {
  const directory = process.argv[2]
  if (!directory) throw new Error("Usage: bun declared-intent-via-pad.ts <raw-directory> [--runtime-root <pinned-checkout>]")
  const flag = process.argv.indexOf("--runtime-root")
  const runtimeRoot = flag >= 0 ? process.argv[flag + 1] : process.cwd()
  if (!runtimeRoot) throw new Error("Pinned runtime root is required")
  console.log(JSON.stringify(await runDeclaredIntentCli(resolve(directory), resolve(runtimeRoot))))
}
