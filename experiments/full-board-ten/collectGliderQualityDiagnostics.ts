import { getFullConnectivityMapFromCircuitJson, getSourcePortConnectivityMapFromCircuitJson } from "circuit-json-to-connectivity-map"

type Row = Record<string, any>
const physicalGroups = ["trace_overlap", "pad_trace", "via_trace", "via_pad", "via_spacing", "via_in_pad"]

/** Post-assessment data only. This never calls a router or changes its output. */
export function collectGliderQualityDiagnostics(circuit: Row[], findings: Record<string, Row[]>, assessment: Row): Row {
  const full = getFullConnectivityMapFromCircuitJson(circuit as Parameters<typeof getFullConnectivityMapFromCircuitJson>[0])
  const source = getSourcePortConnectivityMapFromCircuitJson(circuit as Parameters<typeof getSourcePortConnectivityMapFromCircuitJson>[0])
  const rows = new Map<string, Row>()
  const labels = new Map<string, string[]>()
  for (const row of circuit) {
    const id = row[`${row.type}_id`]
    if (typeof id === "string") rows.set(id, row)
    if (row.type === "source_net") {
      const owner = source.getNetConnectedToId(row.source_net_id)
      if (owner !== undefined) labels.set(owner, [...(labels.get(owner) ?? []), String(row.name)])
    }
  }
  const ownerCache = new Map<string, Row>()
  const ownership = (id: string): Row => {
    const root = full.getNetConnectedToId(id)
    if (root === undefined) return { status: "unresolved", sourceOwnerCount: 0, sourceOwners: [], labels: [] }
    const cached = ownerCache.get(root)
    if (cached) return cached
    const owners = [...new Set(full.getIdsConnectedToNet(root).map(value => source.getNetConnectedToId(value)).filter((value): value is string => typeof value === "string"))]
    const ownerLabels = [...new Set(owners.flatMap(owner => labels.get(owner) ?? []))]
    const value = { status: owners.length === 1 ? "one-source-owner" : owners.length ? "ambiguous-source-owners" : "unresolved", fullIdentifierRoot: root,
      sourceOwnerCount: owners.length, sourceOwners: owners.slice(0, 8), omittedSourceOwners: Math.max(0, owners.length - 8),
      labels: ownerLabels.slice(0, 12), omittedLabelCount: Math.max(0, ownerLabels.length - 12) }
    ownerCache.set(root, value)
    return value
  }
  const representatives: Row[] = []
  for (const group of physicalGroups) {
    const errors = findings[group]?.filter(row => typeof row.type === "string" && row.type.endsWith("_error"))
    if (!errors || errors.length !== assessment.findings[group]) throw new Error(`Finding count mismatch for ${group}`)
    if (!errors.length) continue
    const error = errors[0]!
    const ids = new Set<string>()
    for (const [key, value] of Object.entries(error)) {
      if (!key.endsWith("_id") && !key.endsWith("_ids")) continue
      for (const id of Array.isArray(value) ? value : [value]) if (typeof id === "string" && rows.has(id)) ids.add(id)
    }
    let encodedPairMatchCount = 0
    if (group === "via_in_pad" && typeof error.pcb_placement_error_id === "string") {
      for (const row of circuit) {
        if (row.type !== "pcb_via") continue
        const prefix = `via_in_pad_${row.pcb_via_id}_`
        if (!error.pcb_placement_error_id.startsWith(prefix)) continue
        const padId = error.pcb_placement_error_id.slice(prefix.length)
        const pad = rows.get(padId)
        if (!pad || !["pcb_smtpad", "pcb_plated_hole"].includes(pad.type)) continue
        ids.add(row.pcb_via_id); ids.add(padId); encodedPairMatchCount++
      }
    }
    const geometry: Row[] = []
    for (const id of ids) {
      const row = rows.get(id)!
      if (!["pcb_trace", "pcb_via", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_port", "pcb_component"].includes(row.type)) continue
      if (geometry.length >= 6) break
      geometry.push({ id, ownership: ownership(id), geometry: row.type === "pcb_trace" ? traceContext(row, error) : { ...row } })
    }
    representatives.push({ group, originalErrorCount: errors.length, representativeIndex: 0, omittedErrorExamples: errors.length - 1,
      error, referencedIds: [...ids], encodedPairMatchCount,
      referenceProvenance: group === "via_in_pad" ? "Exact checker via_in_pad ID construction matched against existing via and pad IDs; multiple matches remain explicit." : "Explicit existing primitive IDs only; encoded counterparts may be unavailable.",
      omittedReferencedGeometry: Math.max(0, ids.size - geometry.length), referencedGeometry: geometry })
  }
  const viaGroups = new Map<string, Row[]>()
  const vias = circuit.filter(row => row.type === "pcb_via")
  let unclassifiedViaRows = 0, ambiguousViaOwners = 0, unresolvedViaOwners = 0
  for (const via of vias) {
    if (![via.x, via.y].every(Number.isFinite) || !Array.isArray(via.layers) || !via.layers.length || via.layers.some((layer: unknown) => typeof layer !== "string")) { unclassifiedViaRows++; continue }
    const key = JSON.stringify([via.x, via.y, [...new Set(via.layers)].sort()])
    const group = viaGroups.get(key) ?? []
    group.push(via); viaGroups.set(key, group)
    const owner = ownership(via.pcb_via_id)
    if (owner.status === "ambiguous-source-owners") ambiguousViaOwners++
    else if (owner.status === "unresolved") unresolvedViaOwners++
  }
  const duplicates = { duplicateGroups: 0, duplicateRows: 0, excessRows: 0, sameSourceOwnerGroups: 0, differentSourceOwnerGroups: 0, unknownOrAmbiguousOwnerGroups: 0, mixedDiameterGroups: 0, groupsWithMissingConnectivityKey: 0, groupsWithDifferentNonemptyConnectivityKeys: 0, maximumMultiplicity: 0 }
  for (const group of viaGroups.values()) {
    if (group.length < 2) continue
    duplicates.duplicateGroups++; duplicates.duplicateRows += group.length; duplicates.excessRows += group.length - 1
    duplicates.maximumMultiplicity = Math.max(duplicates.maximumMultiplicity, group.length)
    const owners = group.map(via => ownership(via.pcb_via_id))
    if (owners.some(owner => owner.status !== "one-source-owner")) duplicates.unknownOrAmbiguousOwnerGroups++
    else if (new Set(owners.map(owner => owner.sourceOwners[0])).size === 1) duplicates.sameSourceOwnerGroups++
    else duplicates.differentSourceOwnerGroups++
    if (new Set(group.map(via => JSON.stringify([via.outer_diameter, via.hole_diameter]))).size > 1) duplicates.mixedDiameterGroups++
    if (group.some(via => typeof via.subcircuit_connectivity_map_key !== "string" || !via.subcircuit_connectivity_map_key.length)) duplicates.groupsWithMissingConnectivityKey++
    if (new Set(group.map(via => via.subcircuit_connectivity_map_key).filter(key => typeof key === "string" && key.length)).size > 1) duplicates.groupsWithDifferentNonemptyConnectivityKeys++
  }
  const board = circuit.find(row => row.type === "pcb_board")
  const boardFields = ["min_trace_to_pad_edge_clearance", "min_via_edge_to_pad_edge_clearance", "min_pad_edge_to_pad_edge_clearance", "min_via_hole_edge_to_via_hole_edge_clearance", "min_trace_to_hole_edge_clearance", "is_via_in_pad_allowed", "num_layers", "layer_count"]
  const packet: Row = { version: 1, status: "observed", countsUnchanged: assessment.findings, physicalErrorCount: physicalGroups.reduce((sum, group) => sum + assessment.findings[group], 0), representatives,
    declaredBoardFields: Object.fromEntries(boardFields.filter(key => board && Object.hasOwn(board, key)).map(key => [key, board![key]])),
    viaDuplicateCensus: { grouping: "Exact numeric XY plus sorted emitted layer set; no rounding, physical deduplication or span expansion", viaRows: vias.length, uniqueDeclaredXYSpanGroups: viaGroups.size, unclassifiedViaRows, ambiguousViaOwners, unresolvedViaOwners, ...duplicates },
    canonicalOwnershipScope: "Same published full identifier map plus source-only map. Ownership requires exactly one evidenced source-only owner. Orphans and conflicting owners stay unresolved/ambiguous. No merging by equal labels or geometric endpoint inference.",
    endpointEnrichmentCaveat: "The checker may supplement missing trace endpoint IDs in its private assessment copy. This packet uses unchanged captured identifiers and never mutates that circuit or treats differing orphan components as foreign-net proof.",
    byteLimit: 23_500, geometryOmissions: 0, primitiveOmissions: 0, countsFilteredOrDeduplicated: false }
  while (Buffer.byteLength(JSON.stringify(packet)) > packet.byteLimit) {
    const contexts = representatives.flatMap(item => item.referencedGeometry.map((item: Row) => item.geometry)).filter(item => Array.isArray(item.segments) && item.segments.length > 1)
    contexts.sort((a, b) => b.segments.length - a.segments.length)
    if (contexts.length) { contexts[0].segments.pop(); contexts[0].omittedSegments++; packet.geometryOmissions++; continue }
    const extra = representatives.find(item => item.referencedGeometry.length > 2)
    if (extra) { extra.referencedGeometry.pop(); extra.omittedReferencedGeometry++; packet.primitiveOmissions++; continue }
    throw new Error("Minimum real quality witness exceeds 24KiB; full originals remain in ordinary artifacts")
  }
  return packet
}

function traceContext(trace: Row, error: Row): Row {
  const { route, ...metadata } = trace
  const points: Row[] = Array.isArray(route) ? route : []
  const center = error.center ?? error.pcb_center
  const segments: Row[] = []
  for (let index = 0; index + 1 < points.length; index++) {
    const a = points[index]!, b = points[index + 1]!
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue
    let distance = index
    if (center && [center.x, center.y].every(Number.isFinite)) {
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / length))
      distance = (center.x - a.x - t * dx) ** 2 + (center.y - a.y - t * dy) ** 2
    }
    segments.push({ originalIndex: index, from: a, to: b, selectionDistanceSquared: distance })
  }
  segments.sort((a, b) => a.selectionDistanceSquared - b.selectionDistanceSquared || a.originalIndex - b.originalIndex)
  return { ...metadata, originalRoutePointCount: points.length, segments: segments.slice(0, 8), omittedSegments: Math.max(0, segments.length - 8),
    selection: "Nearest original endpoint chords to the reported center, for bounded context only; not collision revalidation. Original point metadata, including curves, is retained." }
}
