type Obj = Record<string, any>
const own = (object: any, key: string): any => {
  const d = object == null ? undefined : Object.getOwnPropertyDescriptor(object, key)
  if (!d) return undefined
  if (!("value" in d)) throw new Error(`Observer refused accessor ${key}`)
  return d.value
}
const need = (object: any, key: string): any => {
  const value = own(object, key)
  if (value === undefined) throw new Error(`Missing stored field ${key}`)
  return value
}
const finite = (value: any, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Nonfinite ${label}`)
  return value
}

// PRIVATE diagnostic, not a router. No solver methods, getters, or writes.
export function collectCurrentSearchCensus(solver: Obj): Obj {
  try {
    const s = need(solver, "state"), t = need(solver, "topology"), p = need(solver, "problem")
    const routeId = need(s, "currentRouteId"), net = need(s, "currentRouteNetId")
    if (need(p, "routeNet")[routeId] !== net) throw new Error("Current route/net identity mismatch")
    if (own(solver, "partialRipRoutePlans")?.has(routeId)) return { status: "unsupported-active-partial-route" }
    if (own(solver, "outsideInRouteSearch") !== undefined) return { status: "unsupported-active-outside-in-search" }
    const start = need(p, "routeStartPort")[routeId], goal = need(s, "goalPortId")
    if (need(p, "routeEndPort")[routeId] !== goal) throw new Error("Current goal is not the full route end")
    const regionCount = need(t, "regionCount"), portCount = need(t, "portCount")
    const incident = need(t, "incidentPortRegion"), ports = need(t, "regionIncidentPorts")
    const regionNet = need(p, "regionNetId"), section = need(p, "portSectionMask")
    const assignments = need(s, "portAssignment")
    const reservations = need(need(solver, "_problemSetup"), "portEndpointReservationNetId")
    if (regionNet.length < regionCount || section.length < portCount || assignments.length < portCount || reservations.length < portCount) throw new Error("Short native admission table")
    const startRegions = incident[start]
    if (!Array.isArray(startRegions) || startRegions.length > 2 || new Set(startRegions).size !== startRegions.length || startRegions.some((id: number) => !Number.isInteger(id) || id < 0 || id >= regionCount)) throw new Error("Unsupported seed incidence")
    const startRegion = startRegions.find((id: number) => regionNet[id] === -1)
      ?? startRegions.find((id: number) => regionNet[id] === net) ?? startRegions[0]
    if (startRegion === undefined) throw new Error("No start region")
    if (!ports[startRegion]?.includes(start)) throw new Error("Nonreciprocal seed incidence")
    const limits = { regions: 50_000, portInspections: 500_000, boundaryWitnesses: 24, chainCandidates: 4096 }
    if (regionCount > limits.regions) return { status: "unsupported-topology-size", regionCount, limits }
    const seen = new Uint8Array(regionCount), queue = new Int32Array(regionCount)
    const previous = new Int32Array(regionCount).fill(-1)
    let tail = 0, head = 0, inspections = 0, goalRegion: number | undefined
    let status = "disconnected-under-current-hard-admission"
    const regionAllowed = (id: number): boolean => {
      if (!Number.isInteger(regionNet[id])) throw new Error("Invalid region reservation")
      return regionNet[id] === -1 || regionNet[id] === net
    }
    const portReasons = (id: number, region: number): { opposite?: number, reasons: string[] } => {
      if (!Number.isInteger(id) || id < 0 || id >= portCount) throw new Error("Invalid port index")
      const sides: number[] = incident[id]
      if (!Array.isArray(sides) || sides.length > 2 || new Set(sides).size !== sides.length || !sides.includes(region) || sides.some(id => !Number.isInteger(id) || id < 0 || id >= regionCount)) throw new Error("Unsupported or inconsistent port incidence")
      if (![reservations[id], assignments[id], section[id]].every(Number.isInteger)) throw new Error("Invalid port admission value")
      const opposite = sides[0] === region ? sides[1] : sides[0]
      if (opposite !== undefined && !ports[opposite].includes(id)) throw new Error("Nonreciprocal region incidence")
      const reasons: string[] = []
      if (reservations[id] !== -1 && reservations[id] !== net) reasons.push("endpoint-reservation")
      if (assignments[id] !== -1 && assignments[id] !== net) reasons.push("current-assignment")
      // Native goal admission bypasses section mask and the opposite region.
      if (id !== goal) {
        if (section[id] === 0) reasons.push("section-disabled")
        if (opposite === undefined) reasons.push("no-opposite-region")
        else if (!regionAllowed(opposite)) reasons.push("opposite-region-reservation")
      }
      return { opposite, reasons }
    }
    if (regionAllowed(startRegion)) { seen[startRegion] = 1; queue[tail++] = startRegion }
    while (head < tail) {
      const region = queue[head++]!
      for (const port of ports[region]) {
        if (++inspections > limits.portInspections) { status = "census-limit-reached"; break }
        const admission = portReasons(port, region)
        if (admission.reasons.length) continue
        if (port === goal) { goalRegion = region; status = "cost-independent-connection-found"; break }
        const next = admission.opposite!
        if (seen[next]) continue
        seen[next] = 1; previous[next] = region; queue[tail++] = next
      }
      if (status !== "disconnected-under-current-hard-admission") break
    }
    const witnesses: Obj[] = [], reasons: Record<string, number> = {}
    let blockedBoundaryPorts = 0, boundaryInspections = 0
    if (status === "disconnected-under-current-hard-admission" && regionAllowed(startRegion)) {
      for (let i = 0; i < tail; i++) for (const port of ports[queue[i]!]) {
        if (++boundaryInspections > limits.portInspections) throw new Error("Boundary scan exceeded matching census bound")
        const region = queue[i]!, a = portReasons(port, region)
        if (port !== goal && a.opposite !== undefined && seen[a.opposite]) continue
        if (!a.reasons.length) throw new Error("Unvisited open boundary after complete census")
        blockedBoundaryPorts++
        for (const reason of a.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1
        if (witnesses.length < limits.boundaryWitnesses) witnesses.push({
          region, port, oppositeRegion: a.opposite ?? null, reasons: a.reasons,
          reservationNet: reservations[port], assignmentNet: assignments[port],
          oppositeRegionNet: a.opposite === undefined ? null : regionNet[a.opposite],
          sectionMask: section[port], z: need(t, "portZ")[port],
          xy: [need(t, "portX")[port], need(t, "portY")[port]],
          regionLayerMask: need(t, "regionAvailableZMask")[region],
          oppositeLayerMask: a.opposite === undefined ? null : need(t, "regionAvailableZMask")[a.opposite],
        })
      }
    }
    const metadata = need(p, "routeMetadata")
    const ownerIds = new Set<number>()
    for (const witness of witnesses) {
      const committed = new Set<number>(), endpoints: number[] = []
      for (const side of incident[witness.port]) for (const [owner, from, to] of need(s, "regionSegments")[side]) {
        if (from === witness.port || to === witness.port) committed.add(owner)
      }
      for (let id = 0; id < need(p, "routeNet").length; id++) {
        if (need(p, "routeStartPort")[id] === witness.port || need(p, "routeEndPort")[id] === witness.port) endpoints.push(id)
      }
      witness.committedOwners = [...committed].slice(0, 8); witness.committedOwnerCount = committed.size
      witness.endpointOwners = endpoints.slice(0, 8); witness.endpointOwnerCount = endpoints.length
      for (const id of [...witness.committedOwners, ...witness.endpointOwners]) ownerIds.add(id)
    }
    const owners = [...ownerIds].slice(0, 32).map(id => ({ id, net: need(p, "routeNet")[id], connectionId: own(metadata[id], "connectionId"), canonicalNet: own(metadata[id], "mutuallyConnectedNetworkId"), fixed: own(p, "routeIsFixed")?.[id] === 1, preloadedTraceId: own(own(metadata[id], "preloadedTraceSection"), "traceId") ?? null }))
    let necessaryPathRegions: number | null = null
    if (goalRegion !== undefined) { necessaryPathRegions = 0; for (let r = goalRegion; r !== -1; r = previous[r]!) necessaryPathRegions++ }
    const packet: Obj = {
      version: 1, status, routeId, net, connectionId: own(metadata[routeId], "connectionId"), start, goal, startRegion,
      startRegionReservation: regionNet[startRegion], nativeIterations: need(solver, "iterations"),
      scope: "Frozen current-search assignments, including all movable/fixed preloads and committed routes. Not permanent board impossibility after rip-up.",
      limitations: "Cost-independent region reachability is only a necessary condition. Immediate return through the entry port is allowed by this abstraction; entry-angle-dependent single-layer crossings and all g-costs are ignored. No extra layer-mask admission rule is invented. Closed/best-cost/frontier removals are never blockers.",
      aggregation: { regionCount, portCount, discoveredRegions: tail, fullyVisitedRegions: status === "census-limit-reached" || goalRegion !== undefined ? head - 1 : head, portInspections: inspections, boundaryInspections, componentExhausted: status === "disconnected-under-current-hard-admission", necessaryPathRegions, blockedBoundaryPorts, blockedReasons: reasons },
      boundaryWitnesses: witnesses, boundaryWitnessesExhaustive: blockedBoundaryPorts === witnesses.length,
      owners, omittedOwnerRecords: ownerIds.size - owners.length, limits,
      minimumFrontierCost: collectMinimumFrontierCost(solver, limits.chainCandidates),
      canonicalOutputParity: "pending-native-control-comparison", benefitClaim: false,
    }
    while (Buffer.byteLength(JSON.stringify(packet)) > 23_500 && packet.boundaryWitnesses.length > 0) {
      packet.boundaryWitnesses.pop(); packet.boundaryWitnessesExhaustive = false
    }
    packet.omittedBoundaryWitnesses = blockedBoundaryPorts - packet.boundaryWitnesses.length
    if (Buffer.byteLength(JSON.stringify(packet)) > 23_500) throw new Error("Census packet exceeds byte bound")
    return packet
  } catch (error) {
    return { status: "observer-error", observerError: error instanceof Error ? error.message : String(error) }
  }
}

function collectMinimumFrontierCost(solver: Obj, maximum: number): Obj {
  const s = need(solver, "state"), t = need(solver, "topology"), p = need(solver, "problem")
  const candidate = need(need(s, "candidateQueue"), "items")[0]
  if (!candidate) return { status: "empty-queue" }
  const x = need(t, "portX"), y = need(t, "portY"), z = need(t, "portZ")
  const distanceScale = need(solver, "DISTANCE_TO_COST"), addDistance = need(solver, "ADD_SEGMENT_DISTANCE_TO_G")
  const totals = { deltaG: 0, distanceCost: 0, portPenalty: 0, congestion: 0, regionCostResidual: 0 }
  const top: Obj[] = [], seen = new Set<object>()
  let c = candidate, count = 0, root: any
  while (c) {
    if (seen.has(c)) throw new Error("Candidate predecessor cycle")
    if (++count > maximum) return { status: "chain-limit-reached", inspectedCandidates: count - 1, maximum }
    seen.add(c)
    const prev = own(c, "prevCandidate")
    if (!prev) { root = c; break }
    const region = need(prev, "nextRegionId"), from = need(prev, "portId"), to = need(c, "portId")
    if (need(c, "prevRegionId") !== region) throw new Error("Candidate region chain mismatch")
    const dx = x[from] - x[to], dy = y[from] - y[to]
    const distanceCost = addDistance ? Math.sqrt(dx * dx + dy * dy) * distanceScale : 0
    const portPenalty = own(p, "portPenalty")?.[to] ?? 0
    const congestion = need(s, "regionCongestionCost")[region]
    const deltaG = finite(need(c, "g"), "candidate g") - finite(need(prev, "g"), "predecessor g")
    // Residual from ACTUAL stored g values, not a replay of crossing predicates.
    const regionCostResidual = deltaG - distanceCost - portPenalty - congestion
    for (const [key, value] of Object.entries({ deltaG, distanceCost, portPenalty, congestion, regionCostResidual })) totals[key as keyof typeof totals] += finite(value, key)
    const cache = need(s, "regionIntersectionCaches")[region]
    const portMetadata = need(t, "portMetadata")[to], regionMetadata = need(t, "regionMetadata")[region]
    top.push({ region, serializedRegionId: own(regionMetadata, "serializedRegionId"), from, to, xy: [[x[from], y[from]], [x[to], y[to]]], layers: [z[from], z[to]], deltaG, distanceCost, portPenalty, congestion, regionCostResidual, geometry: [need(t, "regionWidth")[region], need(t, "regionHeight")[region]], layerMask: need(t, "regionAvailableZMask")[region], existingCounts: [need(cache, "existingSegmentCount"), need(cache, "existingSameLayerIntersections"), need(cache, "existingCrossingLayerIntersections"), need(cache, "existingEntryExitLayerChanges"), need(cache, "existingRegionCost")], portMetadata: { serializedPortId: own(portMetadata, "serializedPortId") ?? null, sourcePortId: own(portMetadata, "portId") ?? null, tinyHypergraphPortPenalty: own(portMetadata, "tinyHypergraphPortPenalty") ?? null, cramped: own(portMetadata, "cramped") ?? null, duplicatedFromPortId: own(portMetadata, "duplicatedFromPortId") ?? null, distToCentermostPortOnZ: own(portMetadata, "distToCentermostPortOnZ") ?? null }, regionFlags: { containsTarget: own(regionMetadata, "_containsTarget") ?? null, containsObstacle: own(regionMetadata, "_containsObstacle") ?? null, qfpRegionType: own(regionMetadata, "_qfpRegionType") ?? null, isNarrowQfpPadGap: own(regionMetadata, "_isNarrowQfpPadGap") ?? null } })
    top.sort((a, b) => b.deltaG - a.deltaG); if (top.length > 12) top.length = 12
    c = prev
  }
  const g = finite(need(candidate, "g"), "queue minimum g"), rootG = finite(need(root, "g"), "root g")
  return { status: "observed-recorded-costs", candidate: { port: need(candidate, "portId"), nextRegion: need(candidate, "nextRegionId"), g, h: need(candidate, "h"), f: need(candidate, "f") }, root: { port: need(root, "portId"), nextRegion: need(root, "nextRegionId"), g: rootG }, candidates: count, totals, telescopingError: g - rootG - totals.deltaG, largestRecordedCostIncrements: top, interpretation: "Actual predecessor g differences. Region residual is deltaG minus native distance/port/congestion terms; it does not prove which angular intersection caused that cost, or that a finite path to the goal exists." }
}
