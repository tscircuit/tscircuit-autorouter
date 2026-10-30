// Pure extraction of reviewed declared-intent sidecar v3 (fee128fedcfd96c1...).
// Generated source-trace aliases cannot join original owners. The frozen
// independent benchmark oracle and all published predicates remain unchanged.
export type OriginalIntentJson = Record<string, any>
export type OriginalIntentOwner = { status: "RESOLVED"; owner: string; anchors: string[] } |
  { status: "UNKNOWN" | "AMBIGUOUS"; reason: string }
type Input = { original: OriginalIntentJson; pointPairs: OriginalIntentJson; traces: OriginalIntentJson[]; circuitJson: OriginalIntentJson[] }
type CheckName = "viaPad" | "padTrace" | "viaTrace" | "traceOverlap" | "differentNetViaSpacing" | "sameNetViaSpacing" | "padPad"
type GeometryChecker = (circuit: any[], options: { connMap: any; minClearance?: number }) => OriginalIntentJson[]
export type SelectedOriginalIntentCopperReport = {
  schemaVersion: 1
  reportKind: "SELECTED_ORIGINAL_OWNER_COPPER"
  fullCopperGrade: "NOT_EVALUATED"
  allPublishedCopperChecksRun: false
  ownershipCoverageStatus: "COMPLETE" | "UNKNOWN"
  unknownViaCount: number
  unknownPadCount: number
  unknownTraceCount: number
  unknownOwnerReasonCounts: Record<string, number>
  viaCount: number
  padCount: number
  traceCount: number
  checksRun: ["viaTrace", "traceOverlap"]
  checks: Record<"viaTrace" | "traceOverlap", OriginalIntentJson>
  allFindings: OriginalIntentJson[]
  viaOwners: OriginalIntentJson[]
  padOwners: OriginalIntentJson[]
  traceOwners: OriginalIntentJson[]
  originalObstacleCoverage: OriginalIntentJson
  canonicalSemanticKey: string
  copperGeometryKey: string
  originalStackSupported: boolean
  supportedStackLayers: string[]
  geometryUnchanged: true
}
const stable = (value: any): any => Array.isArray(value) ? value.map(stable) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value
const digest = (value: any): string => JSON.stringify(stable(value))
const token = (kind: string, id: string): string => JSON.stringify([kind, id])
const strings = (values: any[]): string[] => [...new Set(values.filter((v): v is string => typeof v === "string" && v.length > 0))]
const unknown = (reason: string): OriginalIntentOwner => ({ status: "UNKNOWN", reason })

export class Pipeline9IntentOwners {
  private parents = new Map<string, string>()
  private aliases = new Map<string, Set<string>>()
  private anchors = new Map<string, string>()
  private pointPairAliases = new Map<string, OriginalIntentOwner[]>()
  private connectionTokens = new Map<string, string[]>()
  private originalTokens: string[] = []
  private ownerByRoot = new Map<string, { owner: string; anchors: string[] }>()
  private ownerIndexDirty = true

  constructor(original: OriginalIntentJson, pointPairs: OriginalIntentJson) {
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

  private ensure(id: string): void {
    if (!this.parents.has(id)) {
      this.parents.set(id, id)
      this.ownerIndexDirty = true
    }
  }
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
    if (a !== b) {
      this.parents.set(b, a)
      this.ownerIndexDirty = true
    }
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
  private rebuildOwnerIndex(): void {
    const anchorsByRoot = new Map<string, string[]>()
    for (const [candidate, name] of this.anchors) {
      const root = this.find(candidate)
      const anchors = anchorsByRoot.get(root) ?? []
      anchors.push(name)
      anchorsByRoot.set(root, anchors)
    }
    this.ownerByRoot.clear()
    for (const [root, anchors] of anchorsByRoot) {
      anchors.sort()
      this.ownerByRoot.set(root, { owner: `intent-owner:${digest(anchors)}`, anchors })
    }
    this.ownerIndexDirty = false
  }
  private typed(id: string): OriginalIntentOwner {
    if (!this.parents.has(id)) return unknown("Identity is absent from original declarations")
    const root = this.find(id)
    // All original unions precede the first resolution. Keep the index local
    // to this freshly constructed inventory; later additions/unions invalidate it.
    if (this.ownerIndexDirty) this.rebuildOwnerIndex()
    const resolved = this.ownerByRoot.get(root)
    if (!resolved) return unknown("Identity has no original connection anchor")
    return { status: "RESOLVED", owner: resolved.owner, anchors: [...resolved.anchors] }
  }
  combine(owners: OriginalIntentOwner[], absent: string): OriginalIntentOwner {
    if (owners.some((owner) => owner.status === "AMBIGUOUS")) return { status: "AMBIGUOUS", reason: "Conflicting declared owner references" }
    const known = owners.filter((owner): owner is Extract<OriginalIntentOwner, { status: "RESOLVED" }> => owner.status === "RESOLVED")
    if (new Set(known.map((owner) => owner.owner)).size > 1) return { status: "AMBIGUOUS", reason: "Distinct original owners resolve the same item" }
    return known[0] ?? unknown(absent)
  }
  originalReference(id: string): OriginalIntentOwner {
    return this.combine([...(this.aliases.get(id) ?? [])].map((typed) => this.typed(typed)), "Reference is absent from original connection/net/terminal declarations")
  }
  traceReference(id: unknown): OriginalIntentOwner {
    if (typeof id !== "string") return unknown("Raw trace lacks connection_name")
    return this.combine([this.originalReference(id), ...(this.pointPairAliases.get(id) ?? [])], "Raw trace connection_name has no explicit original or point-pair root owner")
  }
  port(id: unknown): OriginalIntentOwner {
    return typeof id === "string" ? this.typed(token("port", id)) : unknown("No original PCB-port identity")
  }
  obstacle(obstacle: OriginalIntentJson): OriginalIntentOwner {
    const meta = obstacle.circuitJsonMetadata ?? {}
    return this.combine([...(obstacle.connectedTo ?? []).map((id: string) => this.originalReference(id)), this.port(meta.pcb_port_id)],
      "Original obstacle lacks a resolved declared owner")
  }
}

function padGeometry(pad: OriginalIntentJson): string | undefined {
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

function obstaclePadProjection(obstacle: OriginalIntentJson, index: number): { geometry?: string; aliases: string[] } {
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
  const pad: OriginalIntentJson = { type: multi ? "pcb_plated_hole" : "pcb_smtpad", x, y,
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

function checkOriginalIntentCopperWithPredicates(input: Input, checkerOrSuite: GeometryChecker | Partial<Record<CheckName, GeometryChecker>>, selectedOnly: boolean): OriginalIntentJson {
  const suite: Partial<Record<CheckName, GeometryChecker>> = typeof checkerOrSuite === "function" ? { viaPad: checkerOrSuite } : checkerOrSuite
  if (!selectedOnly && typeof suite.viaPad !== "function") throw new Error("Pinned via-pad checker is required")
  if (selectedOnly && (Object.keys(suite).join(",") !== "viaTrace,traceOverlap" ||
    typeof suite.viaTrace !== "function" || typeof suite.traceOverlap !== "function")) {
    throw new Error("Selected original-owner copper requires exactly the two pinned predicates")
  }
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
  const owners = new Pipeline9IntentOwners(input.original, input.pointPairs)
  const replaced = new Set(input.traces.map((trace) => trace.__replaces_pcb_trace_id).filter(Boolean))
  const rawTraces = [...(input.original.traces ?? []).filter((trace: OriginalIntentJson) => !replaced.has(trace.pcb_trace_id)), ...input.traces]
  const traceOwners = new Map<string, OriginalIntentOwner[]>()
  for (const trace of rawTraces) {
    if (typeof trace.pcb_trace_id !== "string") continue
    const list = traceOwners.get(trace.pcb_trace_id) ?? []
    list.push(owners.traceReference(trace.connection_name))
    traceOwners.set(trace.pcb_trace_id, list)
  }
  const obstacles = (input.original.obstacles ?? []).map((obstacle: OriginalIntentJson, index: number) =>
    ({ obstacle, originalIndex: index, owner: owners.obstacle(obstacle), ...obstaclePadProjection(obstacle, index) }))
  const transformed = structuredClone(input.circuitJson)
  const identities = new Map<string, OriginalIntentJson>()
  const representedObstacles = new Set<number>()
  const viaOwners: OriginalIntentJson[] = [], padOwners: OriginalIntentJson[] = [], traceOwnerRecords: OriginalIntentJson[] = []
  for (const [index, element] of transformed.entries()) {
    if (!["pcb_via", "pcb_smtpad", "pcb_plated_hole", "pcb_trace"].includes(element.type)) continue
    const field = element.type === "pcb_via" ? "pcb_via_id" : element.type === "pcb_trace" ? "pcb_trace_id" : element.type === "pcb_smtpad" ? "pcb_smtpad_id" : "pcb_plated_hole_id"
    const originalId = element[field]
    let owner: OriginalIntentOwner
    let mapping: string
    if (element.type === "pcb_trace") {
      const candidates = traceOwners.get(originalId) ?? []
      const supported = Array.isArray(element.route) && element.route.every((point: OriginalIntentJson) =>
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
      const matching = obstacles.filter((candidate: OriginalIntentJson) => candidate.geometry !== undefined && candidate.geometry === geometry && candidate.aliases.includes(originalId))
      for (const candidate of matching) representedObstacles.add(candidate.originalIndex)
      const candidates: OriginalIntentOwner[] = matching.map((candidate: OriginalIntentJson) => candidate.owner)
      // A canonical port association cannot turn an unowned obstacle into owned copper.
      if (matching.length > 0 && candidates.some((candidate) => candidate.status === "RESOLVED")) candidates.push(owners.port(element.pcb_port_id))
      const padLayersSupported = element.type === "pcb_smtpad" ? layerSupported(element.layer) : layerListSupported(element.layers)
      owner = !padLayersSupported ? unknown("Canonical pad layers are missing or outside the original declared stack") :
        matching.some((candidate: OriginalIntentJson) => candidate.owner.status === "UNKNOWN")
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
  const allFindings: OriginalIntentJson[] = [], checks: OriginalIntentJson = {}
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
  const knownForeignFindingCount = selectedOnly ? undefined : checks.viaPad.knownForeignFindingCount
  const unknownFindingCount = selectedOnly ? undefined : checks.viaPad.unknownFindingCount
  const knownForeignCopperFindingCount = allFindings.filter((finding) => finding.classification === "DECLARED_FOREIGN_COPPER").length
  const unknownCopperFindingCount = allFindings.filter((finding) => finding.classification === "UNKNOWN_OWNER_COPPER").length
  const definiteCopperRuleFindingCount = allFindings.length - unknownCopperFindingCount
  const unknownViaCount = viaOwners.filter((owner) => owner.status !== "RESOLVED").length
  const unknownTraceCount = traceOwnerRecords.filter((owner) => owner.status !== "RESOLVED").length
  const unknownPadCount = padOwners.filter((owner) => owner.status !== "RESOLVED").length
  const unmappedOriginalObstacles = obstacles.filter((candidate: OriginalIntentJson) => !candidate.obstacle.isNonPlatedHole &&
    !candidate.obstacle.circuitJsonMetadata?.pcb_via_id && !representedObstacles.has(candidate.originalIndex))
  const unmappedDeclaredCopper = unmappedOriginalObstacles.filter((candidate: OriginalIntentJson) => {
    const meta = candidate.obstacle.circuitJsonMetadata ?? {}
    return !!(meta.pcb_smtpad_id || meta.pcb_plated_hole_id || meta.pcb_port_id ||
      (meta.source_component_name && meta.source_port_name))
  })
  const coverageUnknown = !stackSupported || unknownViaCount + unknownPadCount + unknownTraceCount + unmappedDeclaredCopper.length > 0
  const unknownOwnerReasonCounts: Record<string, number> = {}
  for (const item of [...viaOwners, ...padOwners, ...traceOwnerRecords].filter((item) => item.status !== "RESOLVED")) {
    const reason = `${item.status}:${item.reason}`
    unknownOwnerReasonCounts[reason] = (unknownOwnerReasonCounts[reason] ?? 0) + 1
  }
  const geometryOnly = (elements: OriginalIntentJson[]): OriginalIntentJson[] => elements.filter((e) => ["pcb_via", "pcb_smtpad", "pcb_plated_hole", "pcb_trace"].includes(e.type)).map((e) =>
    Object.fromEntries(Object.entries(e).filter(([key]) => !key.endsWith("_id") && !key.endsWith("_ids"))))
  const beforeGeometry = digest(geometryOnly(input.circuitJson)), afterGeometry = digest(geometryOnly(transformed))
  if (beforeGeometry !== afterGeometry) throw new Error("Offline checker changed copper geometry")
  const allPublishedCopperChecksRun = ["viaPad", "padTrace", "viaTrace", "traceOverlap", "differentNetViaSpacing", "sameNetViaSpacing", "padPad"].every((name) => checks[name] !== undefined)
  if (selectedOnly) return {
    schemaVersion: 1, reportKind: "SELECTED_ORIGINAL_OWNER_COPPER", fullCopperGrade: "NOT_EVALUATED",
    allPublishedCopperChecksRun: false, ownershipCoverageStatus: coverageUnknown ? "UNKNOWN" : "COMPLETE",
    unknownViaCount, unknownPadCount, unknownTraceCount, unknownOwnerReasonCounts,
    viaCount: viaOwners.length, padCount: padOwners.length, traceCount: traceOwnerRecords.length,
    checksRun: Object.keys(checks), checks, allFindings, viaOwners, padOwners, traceOwners: traceOwnerRecords,
    originalObstacleCoverage: { originalCount: obstacles.length, representedCount: representedObstacles.size,
      unmappedCount: unmappedOriginalObstacles.length, unmappedDeclaredCopperCount: unmappedDeclaredCopper.length,
      unmappedDeclaredCopper: unmappedDeclaredCopper.map((candidate: OriginalIntentJson) => ({ originalIndex: candidate.originalIndex,
        declaredIds: candidate.aliases, ownerStatus: candidate.owner.status })),
      genericUnmappedObstacleScope: "Generic SRJ obstacle rectangles without typed copper provenance are reported as unmapped; they are not silently invented as manufactured pads." },
    canonicalSemanticKey: digest(input.circuitJson), copperGeometryKey: beforeGeometry,
    originalStackSupported: stackSupported, supportedStackLayers: stackLayers, geometryUnchanged: true,
  }
  const status = knownForeignFindingCount > 0 ? "FAIL_FOREIGN_CLEARANCE" : knownForeignCopperFindingCount > 0 ? "FAIL_FOREIGN_COPPER" :
    definiteCopperRuleFindingCount > 0 ? "FAIL_SUPPORTED_COPPER_RULE" : coverageUnknown || unknownCopperFindingCount > 0 ? "UNKNOWN_OWNERSHIP" : "PASS"
  return { schemaVersion: 2, status, qualifiedPhysicalClean: status === "PASS" && allPublishedCopperChecksRun,
    qualifiedSupportedCopper: status === "PASS" && allPublishedCopperChecksRun, allPublishedCopperChecksRun,
    ownershipCoverageStatus: coverageUnknown ? "UNKNOWN" : "COMPLETE", knownForeignFindingCount, unknownFindingCount,
    unknownViaCount, unknownPadCount, unknownTraceCount, unknownOwnerReasonCounts, viaCount: viaOwners.length, padCount: padOwners.length, traceCount: traceOwnerRecords.length,
    knownForeignCopperFindingCount, unknownCopperFindingCount, definiteCopperRuleFindingCount, checksRun: Object.keys(checks), checks,
    appliedMinClearance: minClearance ?? null,
    clearanceSource: minClearance === undefined ? "PINNED_CHECKER_BOARD_OR_DEFAULT" : "MAXIMUM_ORIGINAL_DECLARED_VIA_PAD_AND_PAD_PAD_CLEARANCE", findings: checks.viaPad.findings, allFindings, viaOwners, padOwners, traceOwners: traceOwnerRecords,
    originalObstacleCoverage: { originalCount: obstacles.length, representedCount: representedObstacles.size,
      unmappedCount: unmappedOriginalObstacles.length, unmappedDeclaredCopperCount: unmappedDeclaredCopper.length,
      unmappedDeclaredCopper: unmappedDeclaredCopper.map((candidate: OriginalIntentJson) => ({ originalIndex: candidate.originalIndex,
        declaredIds: candidate.aliases, ownerStatus: candidate.owner.status })),
      genericUnmappedObstacleScope: "Generic SRJ obstacle rectangles without typed copper provenance are reported as unmapped; they are not silently invented as manufactured pads." },
    canonicalSemanticKey: digest(input.circuitJson), copperGeometryKey: beforeGeometry,
    originalStackSupported: stackSupported, supportedStackLayers: stackLayers,
    geometryUnchanged: true,
    scope: "Additive offline declared-intent copper predicates only; board/hole and official validation remain unchanged. Predicates use pinned published geometry; each class reports findings without deduplicating cross-class duplicates. No routing or geometry optimization. All unresolved or ambiguous owners and missing explicit original copper prevent PASS. This is not a proof of unsupported manufacturing/electrical rules.",
  }
}

/** Preserve the full and legacy partial checker APIs and their exact reports. */
export function checkPipeline9OriginalIntentCopper(
  input: Input,
  checkerOrSuite: GeometryChecker | Partial<Record<CheckName, GeometryChecker>>,
): OriginalIntentJson {
  return checkOriginalIntentCopperWithPredicates(input, checkerOrSuite, false)
}

/** Recheck the entire owner/material inventory, without claiming a full grade. */
export function checkPipeline9SelectedOriginalIntentCopper(
  input: Input,
  suite: Record<"viaTrace" | "traceOverlap", GeometryChecker>,
): SelectedOriginalIntentCopperReport {
  return checkOriginalIntentCopperWithPredicates(input,
    { viaTrace: suite.viaTrace, traceOverlap: suite.traceOverlap }, true) as SelectedOriginalIntentCopperReport
}
