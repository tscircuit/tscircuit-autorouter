type Obj = Record<string, any>
type Mode = "current" | "verified-movable-owners-relaxed" | "all-assignments-relaxed"
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

// Private observation only. No solver getters/predicates, assignments or routes are changed.
export function collectGoalSideRecoverability(solver: Obj): Obj {
  try {
    const s = need(solver, "state"), t = need(solver, "topology"), p = need(solver, "problem")
    const routeId = need(s, "currentRouteId"), net = need(s, "currentRouteNetId")
    const routeNet = need(p, "routeNet"), starts = need(p, "routeStartPort"), ends = need(p, "routeEndPort"), metadata = need(p, "routeMetadata")
    if (routeNet[routeId] !== net) throw new Error("Current route/net mismatch")
    if (own(solver, "partialRipRoutePlans")?.has(routeId) || own(solver, "outsideInRouteSearch") !== undefined) return { status: "unsupported-active-special-search" }
    const start = starts[routeId], goal = need(s, "goalPortId")
    if (goal !== ends[routeId] || goal === start) return { status: "unsupported-terminal-identity" }
    const rc = need(t, "regionCount"), pc = need(t, "portCount")
    const limits = { regions: 50_000, portInspectionsPerMode: 500_000, indexedSegments: 1_000_000, witnessesPerMode: 8, relaxedPathPortsPerMode: 8 }
    if (rc > limits.regions) return { status: "unsupported-topology-size", regionCount: rc, limits }
    const incident = need(t, "incidentPortRegion"), ports = need(t, "regionIncidentPorts"), regionMetadata = need(t, "regionMetadata")
    const regionNet = need(p, "regionNetId"), section = need(p, "portSectionMask"), assigned = need(s, "portAssignment")
    const reserved = need(need(solver, "_problemSetup"), "portEndpointReservationNetId")
    const fixed = own(p, "routeIsFixed"), segments = need(s, "regionSegments")
    if (regionNet.length < rc || section.length < pc || assigned.length < pc || reserved.length < pc || (fixed && fixed.length < routeNet.length)) throw new Error("Short native admission table")
    const checkPort = (port: number, region?: number): number[] => {
      const sides = incident[port]
      if (!Number.isInteger(port) || port < 0 || port >= pc || !Array.isArray(sides) || sides.length > 2 || new Set(sides).size !== sides.length || (region !== undefined && !sides.includes(region))) throw new Error("Unsupported port incidence")
      for (const side of sides) if (!Number.isInteger(side) || side < 0 || side >= rc || !ports[side]?.includes(port)) throw new Error("Nonreciprocal port incidence")
      if (![assigned[port], reserved[port], section[port]].every(Number.isInteger)) throw new Error("Invalid port admission value")
      return sides
    }
    const terminal = (port: number): Obj => {
      const sides = checkPort(port)
      const leaves = sides.filter(id => own(regionMetadata[id], "_tinyTerminal") === true)
      const real = sides.filter(id => own(regionMetadata[id], "_tinyTerminal") !== true)
      if (sides.length !== 2 || leaves.length !== 1 || real.length !== 1 || ports[leaves[0]].length !== 1 || ports[leaves[0]][0] !== port || regionNet[leaves[0]] !== net) throw new Error("Unsupported terminal-leaf contract")
      return { port, sides, leaf: leaves[0], real: real[0] }
    }
    const sourceTerminal = terminal(start), goalTerminal = terminal(goal)
    const startRegion = sourceTerminal.sides.find((id: number) => regionNet[id] === -1) ?? sourceTerminal.sides.find((id: number) => regionNet[id] === net) ?? sourceTerminal.sides[0]
    const regionAllowed = (region: number): boolean => {
      if (!Number.isInteger(regionNet[region])) throw new Error("Invalid region reservation")
      return regionNet[region] === -1 || regionNet[region] === net
    }
    const owners = new Map<number, Set<number>>(), unknown = new Set<number>()
    let segmentCount = 0
    // Build the COMPLETE current owner index; never clear initial/movable preloads.
    for (let region = 0; region < rc; region++) for (const segment of segments[region]) {
      if (++segmentCount > limits.indexedSegments) return { status: "owner-index-limit-reached", indexedSegments: segmentCount - 1, limits }
      const [owner, from, to] = segment
      for (const port of [from, to]) {
        if (!Number.isInteger(port) || port < 0 || port >= pc) throw new Error("Invalid current segment port")
        if (assigned[port] === -1 || assigned[port] === net) continue
        const list = owners.get(port) ?? new Set<number>(); list.add(owner); owners.set(port, list)
        if (!Number.isInteger(owner) || owner < 0 || owner >= routeNet.length || routeNet[owner] !== assigned[port] || typeof own(metadata[owner], "connectionId") !== "string" || !incident[port].includes(region) || !ports[region].includes(port)) unknown.add(port)
      }
    }
    const ownerClass = (port: number): string => {
      const list = owners.get(port)
      if (assigned[port] === -1 || assigned[port] === net) return "free-or-own-net"
      if (!list?.size || unknown.has(port)) return "unknown-or-mismatched-owners"
      for (const owner of list) if (fixed?.[owner] === 1 || own(metadata[owner], "isFixed") === true) return "fixed-or-shared-fixed"
      return "verified-movable-owners"
    }
    const ownershipCounts: Record<string, number> = {}
    for (let port = 0; port < pc; port++) if (assigned[port] !== -1 && assigned[port] !== net) { const kind = ownerClass(port); ownershipCounts[kind] = (ownershipCounts[kind] ?? 0) + 1 }
    const assignmentAllowed = (port: number, mode: Mode): boolean => assigned[port] === -1 || assigned[port] === net || mode === "all-assignments-relaxed" || (mode === "verified-movable-owners-relaxed" && ownerClass(port) === "verified-movable-owners")
    const reservationAllowed = (port: number): boolean => reserved[port] === -1 || reserved[port] === net
    const modeResults: Obj[] = []
    for (const mode of ["current", "verified-movable-owners-relaxed", "all-assignments-relaxed"] as Mode[]) {
      const seen = new Uint8Array(rc), queue = new Int32Array(rc), previousRegion = new Int32Array(rc).fill(-1), previousPort = new Int32Array(rc).fill(-1)
      const goalAdmission = { reservationAllowed: reservationAllowed(goal), assignmentAllowed: assignmentAllowed(goal, mode) }
      const seeds = goalAdmission.reservationAllowed && goalAdmission.assignmentAllowed ? goalTerminal.sides.filter(regionAllowed) : []
      let tail = 0, head = 0, inspections = 0, status = "disconnected-under-mode"
      for (const region of seeds) { seen[region] = 1; queue[tail++] = region }
      const admission = (port: number, region: number): Obj => {
        const sides = checkPort(port, region), other = sides[0] === region ? sides[1] : sides[0], reasons: string[] = []
        if (!reservationAllowed(port)) reasons.push("endpoint-reservation")
        if (!assignmentAllowed(port, mode)) reasons.push("current-assignment")
        if (section[port] === 0) reasons.push("section-disabled")
        if (other === undefined) reasons.push("no-opposite-region")
        else if (!regionAllowed(other)) reasons.push("opposite-region-reservation")
        return { other, reasons }
      }
      while (head < tail) {
        const region = queue[head++]!
        // Native start is a selected REGION seed: do not add source-port checks here.
        if (region === startRegion) { status = "cost-independent-connection-found"; break }
        for (const port of ports[region]) {
          if (++inspections > limits.portInspectionsPerMode) { status = "census-limit-reached"; break }
          if (port === goal) continue // Goal is acceptance from either seed, not an ordinary reverse edge.
          const a = admission(port, region)
          if (a.reasons.length || seen[a.other]) continue
          seen[a.other] = 1; previousRegion[a.other] = region; previousPort[a.other] = port; queue[tail++] = a.other
        }
        if (status === "census-limit-reached") break
      }
      const boundary: any[] = [], blockedReasons: Record<string, number> = {}
      let boundaryCount = 0, boundaryInspections = 0
      if (status === "disconnected-under-mode") for (let index = 0; index < tail; index++) for (const port of ports[queue[index]!]) {
        if (++boundaryInspections > limits.portInspectionsPerMode) throw new Error("Boundary scan exceeds census bound")
        if (port === goal) continue
        const region = queue[index]!, a = admission(port, region)
        if (a.other !== undefined && seen[a.other]) continue
        if (!a.reasons.length) throw new Error("Open boundary after complete reverse census")
        boundaryCount++
        for (const reason of a.reasons) blockedReasons[reason] = (blockedReasons[reason] ?? 0) + 1
        if (boundary.length < limits.witnessesPerMode) boundary.push([region, port, a.other ?? null, a.reasons])
      }
      const relaxedPathPorts: number[] = []
      let pathRegions: number | null = null, relaxedPathPortCount = 0
      if (status === "cost-independent-connection-found") {
        pathRegions = 0
        for (let region = startRegion; region !== -1; region = previousRegion[region]!) {
          pathRegions++
          const port = previousPort[region]
          if (port >= 0 && assigned[port] !== -1 && assigned[port] !== net) { relaxedPathPortCount++; if (relaxedPathPorts.length < limits.relaxedPathPortsPerMode) relaxedPathPorts.push(port) }
        }
        if (assigned[goal] !== -1 && assigned[goal] !== net) { relaxedPathPortCount++; if (relaxedPathPorts.length < limits.relaxedPathPortsPerMode) relaxedPathPorts.push(goal) }
      }
      modeResults.push({ mode, status, goalAdmission, goalSeedRegions: seeds, discoveredRegions: tail, portInspections: inspections, componentExhausted: status === "disconnected-under-mode", boundaryInspections, blockedBoundaryCount: boundaryCount, blockedReasons, boundaryWitnesses: boundary, necessaryPathRegions: pathRegions, relaxedPathPortCount, relaxedPathPorts })
    }
    const makeContexts = (): Obj => {
      const selectedPorts = new Set<number>([start, goal]), selectedRegions = new Set<number>([...sourceTerminal.sides, ...goalTerminal.sides]), selectedOwners = new Set<number>()
      for (const result of modeResults) {
        for (const [r, port, other] of result.boundaryWitnesses) { selectedPorts.add(port); selectedRegions.add(r); if (other !== null) selectedRegions.add(other) }
        for (const port of result.relaxedPathPorts) { selectedPorts.add(port); for (const region of incident[port]) selectedRegions.add(region) }
      }
      const portRows = [...selectedPorts].map(port => {
        const list = [...(owners.get(port) ?? [])], endpoints: number[] = []
        for (let id = 0; id < routeNet.length; id++) if (starts[id] === port || ends[id] === port) endpoints.push(id)
        for (const id of [...list, ...endpoints]) if (Number.isInteger(id) && id >= 0 && id < routeNet.length) selectedOwners.add(id)
        return { id: port, sid: own(need(t, "portMetadata")[port], "serializedPortId"), xyz: [need(t, "portX")[port], need(t, "portY")[port], need(t, "portZ")[port]], incidentRegions: incident[port], assignmentNet: assigned[port], reservationNet: reserved[port], sectionMask: section[port], ownerClass: ownerClass(port), committedOwners: list.slice(0, 8), committedOwnerCount: list.length, endpointOwners: endpoints.slice(0, 8), endpointOwnerCount: endpoints.length }
      })
      const regionRows = [...selectedRegions].map(id => {
        const matchingNetRoutes: number[] = []
        for (let route = 0; route < routeNet.length; route++) if (routeNet[route] === regionNet[id]) matchingNetRoutes.push(route)
        for (const route of matchingNetRoutes.slice(0, 4)) selectedOwners.add(route)
        return { id, sid: own(regionMetadata[id], "serializedRegionId"), net: regionNet[id], canonicalNets: [...new Set(matchingNetRoutes.map(route => own(metadata[route], "mutuallyConnectedNetworkId")))], matchingNetRoutes: matchingNetRoutes.slice(0, 4), matchingNetRouteCount: matchingNetRoutes.length, layerMask: need(t, "regionAvailableZMask")[id], geometry: [need(t, "regionCenterX")[id], need(t, "regionCenterY")[id], need(t, "regionWidth")[id], need(t, "regionHeight")[id]], incidentPortCount: ports[id].length, terminal: own(regionMetadata[id], "_tinyTerminal") === true, containsTarget: own(regionMetadata[id], "_containsTarget") ?? null, containsObstacle: own(regionMetadata[id], "_containsObstacle") ?? null }
      })
      const ownerRows = [...selectedOwners].slice(0, 48).map(id => ({ id, net: routeNet[id], connectionId: own(metadata[id], "connectionId"), canonicalNet: own(metadata[id], "mutuallyConnectedNetworkId"), fixed: fixed?.[id] === 1, metadataFixed: own(metadata[id], "isFixed") ?? null, preloadedTraceId: own(own(metadata[id], "preloadedTraceSection"), "traceId") ?? null, endpointPorts: [starts[id], ends[id]] }))
      return { ports: portRows, regions: regionRows, owners: ownerRows, omittedOwnerRecords: selectedOwners.size - ownerRows.length }
    }
    for (const result of modeResults) { result.omittedBoundaryWitnesses = result.blockedBoundaryCount - result.boundaryWitnesses.length; result.omittedRelaxedPathPorts = result.relaxedPathPortCount - result.relaxedPathPorts.length }
    const packet: Obj = { version: 1, status: "observed", routeId, net, connectionId: own(metadata[routeId], "connectionId"), nativeIterations: need(solver, "iterations"), start, goal, startRegion, sourceTerminal, goalTerminal, segmentCount, ownershipCounts, limits, modes: modeResults, boundaryWitnessColumns: ["reachableGoalSideRegion", "port", "oppositeRegion", "blockingReasons"], ...makeContexts(), interpretation: "Necessary-condition reverse region census only. Goal port is an acceptance seed, not an ordinary edge; target is the exact native start-region seed. Current preserves every assignment. Movable mode relaxes only nonempty fully-known matching-net owners with no fixed owner. All-relaxed mode may ignore fixed copper and is counterfactual, never a recovery permission. All modes retain endpoint/region/section restrictions and relax angular costs/entry-port exclusion; connected does not prove a finite route. Sampled boundary witnesses are not a minimum cut.", canonicalOutputParity: "pending-native-control-comparison", benefitClaim: false }
    while (Buffer.byteLength(JSON.stringify(packet)) > 23_500) {
      const result = [...modeResults].reverse().find(r => r.boundaryWitnesses.length > 0 || r.relaxedPathPorts.length > 0)
      if (!result) throw new Error("Aggregate packet exceeds byte budget")
      if (result.boundaryWitnesses.length) result.boundaryWitnesses.pop(); else result.relaxedPathPorts.pop()
      result.omittedBoundaryWitnesses = result.blockedBoundaryCount - result.boundaryWitnesses.length
      result.omittedRelaxedPathPorts = result.relaxedPathPortCount - result.relaxedPathPorts.length
      Object.assign(packet, makeContexts())
    }
    return packet
  } catch (error) {
    return { status: "observer-error", observerError: error instanceof Error ? error.message : String(error) }
  }
}
