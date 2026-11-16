type Obj = Record<string, any>

// Diagnostic-only: never invoke a solver method, accessor, or geometry predicate.
const own = (object: any, key: string): any => {
  if (object === undefined || object === null) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (!descriptor) return undefined
  if (!("value" in descriptor)) throw new Error(`Observer refused accessor ${key}`)
  return descriptor.value
}
const need = (object: any, key: string): any => {
  const value = own(object, key)
  if (value === undefined) throw new Error(`Missing stored field ${key}`)
  return value
}
const number = (value: any): any => Number.isFinite(value) ? value : String(value)
const point = (p: any): any => p ? {
  pointId: own(p, "pointId") ?? null, pcbPortId: own(p, "pcb_port_id") ?? null,
  x: own(p, "x"), y: own(p, "y"), layer: own(p, "layer") ?? null,
  layers: own(p, "layers") ?? null, terminalVia: own(p, "terminalVia") ?? null,
} : null

export function collectPendingTerminalCut(solver: Obj, pathing: Obj, trigger: string): Obj {
  try {
    const state = need(solver, "state"), topology = need(solver, "topology"), problem = need(solver, "problem")
    const routeId = own(state, "currentRouteId")
    if (routeId === undefined) return { version: 1, trigger, status: "no-current-route" }
    const routeNet = need(problem, "routeNet"), routeMetadata = need(problem, "routeMetadata")
    const metadata = routeMetadata[routeId], connection = own(metadata, "simpleRouteConnection")
    const endpointPorts = [need(problem, "routeStartPort")[routeId], need(problem, "routeEndPort")[routeId]]
    const incidence = need(topology, "incidentPortRegion"), regionPorts = need(topology, "regionIncidentPorts")
    const regionMetadata = need(topology, "regionMetadata"), portMetadata = need(topology, "portMetadata")
    const regionNet = need(problem, "regionNetId"), segments = need(state, "regionSegments")
    const setup = need(solver, "_problemSetup"), reservations = need(setup, "portEndpointReservationNetId")
    const assignments = need(state, "portAssignment"), sectionMask = need(problem, "portSectionMask")
    const portX = need(topology, "portX"), portY = need(topology, "portY"), portZ = need(topology, "portZ")
    const angle1 = need(topology, "portAngleForRegion1"), angle2 = own(topology, "portAngleForRegion2")
    const layerMasks = need(topology, "regionAvailableZMask"), caches = need(state, "regionIntersectionCaches")
    const realRegionIds: number[] = [], terminalRegionIds: number[] = []
    for (const port of endpointPorts) for (const id of incidence[port]) {
      const target = own(regionMetadata[id], "_tinyTerminal") === true ? terminalRegionIds : realRegionIds
      if (!target.includes(id)) target.push(id)
    }
    if (realRegionIds.length > 4 || terminalRegionIds.length > 4) throw new Error("Unexpected terminal incidence cardinality")
    const allSelectedPorts = [...new Set<number>([...endpointPorts, ...realRegionIds.flatMap(id => regionPorts[id])])]
    const selectedPorts = allSelectedPorts.slice(0, 64)
    const selectedSet = new Set(selectedPorts)
    const queue = need(state, "candidateQueue"), items = need(queue, "items")
    const qGeneration = need(queue, "currentHopStateGeneration")
    const qSeen = own(queue, "hopStateGeneration"), qIndex = own(queue, "hopIndexOrClosed")
    const qMap = need(queue, "indexByHopId"), qClosed = need(queue, "closedHopIds")
    const bestGeneration = need(state, "candidateBestCostGeneration")
    const bestSeen = need(state, "candidateBestCostGenerationByHopId"), best = need(state, "candidateBestCostByHopId")
    const stride = need(solver, "candidateHopSlotStride"), first = need(solver, "candidateFirstRegionByPortId"), second = need(solver, "candidateSecondRegionByPortId")
    const overflow = own(solver, "candidateOverflowBestCost")
    const hopId = (port: number, region: number): number => {
      const base = port * stride
      if (first[port] === region) return base
      if (second[port] === region) return base + 1
      const slot = incidence[port].indexOf(region)
      return slot >= 2 ? base + slot : -(port * need(topology, "regionCount") + region) - 1
    }
    const candidate = (c: any): any => c ? [own(c, "portId"), own(c, "nextRegionId"), own(c, "prevRegionId") ?? null, number(own(c, "g")), number(own(c, "h")), number(own(c, "f"))] : null
    const hopRow = (port: number, region: number): any[] => {
      const id = hopId(port, region)
      const generation = bestSeen instanceof Map ? bestSeen.get(id) : bestSeen[id]
      const cost = id < 0 ? overflow?.get(id) ?? Infinity : generation === bestGeneration ? best instanceof Map ? best.get(id) : best[id] : Infinity
      let closed: boolean, index: number | undefined
      if (id >= 0 && qSeen !== undefined) {
        if (!qIndex) throw new Error("Missing heap index array")
        const current = qSeen[id] === qGeneration
        closed = current && qIndex[id] === -1
        index = current && qIndex[id] >= 0 ? qIndex[id] : undefined
      } else { closed = qClosed.has(id); index = qMap.get(id) }
      const queued = index === undefined ? undefined : items[index]
      if (index !== undefined && (!queued || own(queued, "portId") !== port || own(queued, "nextRegionId") !== region)) throw new Error("Heap index/candidate identity mismatch")
      return [port, region, id, number(cost), generation ?? null, closed, index ?? null, candidate(queued)]
    }
    const touchedRegions = [...new Set<number>(selectedPorts.flatMap(port => incidence[port]))]
    const ownersByPort = new Map<number, Set<number>>()
    const endpointOwnersByPort = new Map<number, number[]>()
    for (const port of selectedPorts) ownersByPort.set(port, new Set())
    for (const port of selectedPorts) endpointOwnersByPort.set(port, [])
    const routeStarts = need(problem, "routeStartPort"), routeEnds = need(problem, "routeEndPort")
    for (let id = 0; id < routeNet.length; id++) {
      endpointOwnersByPort.get(routeStarts[id])?.push(id)
      if (routeEnds[id] !== routeStarts[id]) endpointOwnersByPort.get(routeEnds[id])?.push(id)
    }
    for (const region of touchedRegions) for (const [owner, from, to] of segments[region]) {
      ownersByPort.get(from)?.add(owner); ownersByPort.get(to)?.add(owner)
    }
    const ownerIds = new Set<number>()
    const regionRows: Obj[] = []
    const workspace = own(solver, "workspace"), frontiers = own(workspace, "frontiers")
    const graph = own(own(pathing, "params"), "graph"), graphRegions = own(graph, "regions")
    for (const region of [...realRegionIds, ...terminalRegionIds]) {
      const m = regionMetadata[region], cache = caches[region], rawSegments = segments[region]
      const source = graphRegions?.find((r: Obj) => own(r, "regionId") === own(m, "serializedRegionId"))
      const d = own(source, "d")
      const capturedSegments = rawSegments.slice(0, 32).map(([r, from, to]: number[]) => { ownerIds.add(r); return [r, from, to] })
      const frontier = frontiers instanceof Map ? frontiers.get(region) : undefined
      const retained: number[] = []
      if (frontier) {
        const neighbors = need(frontier, "neighbors"), next = need(frontier, "next")
        let i = need(frontier, "head"), visits = 0
        while (i !== -1 && visits++ <= neighbors.length) { retained.push(neighbors[i]); i = next[i] }
        if (i !== -1) throw new Error("Malformed stored frontier chain")
      }
      const cacheSize = need(cache, "netIds").length
      regionRows.push({
        id: region, sid: own(m, "serializedRegionId"), terminal: own(m, "_tinyTerminal") === true,
        net: regionNet[region], mask: layerMasks[region],
        geometry: [need(topology, "regionCenterX")[region], need(topology, "regionCenterY")[region], need(topology, "regionWidth")[region], need(topology, "regionHeight")[region]],
        source: { matched: Boolean(source), availableZ: own(d, "availableZ") ?? own(m, "availableZ") ?? null, containsObstacle: own(d, "_containsObstacle") ?? own(m, "_containsObstacle") ?? null, containsTarget: own(d, "_containsTarget") ?? own(m, "_containsTarget") ?? null, targetConnectionName: own(d, "_targetConnectionName") ?? null, connectedTo: own(d, "_connectedTo") ?? null },
        portCount: regionPorts[region].length, ports: regionPorts[region].filter((p: number) => selectedSet.has(p)),
        segmentCount: rawSegments.length, segments: capturedSegments,
        congestion: number(need(state, "regionCongestionCost")[region]),
        cacheCounts: [need(cache, "existingSegmentCount"), need(cache, "existingSameLayerIntersections"), need(cache, "existingCrossingLayerIntersections"), need(cache, "existingEntryExitLayerChanges"), number(need(cache, "existingRegionCost"))],
        cacheSegmentCount: cacheSize,
        cacheSegments: Array.from({ length: Math.min(cacheSize, 32) }, (_, i) => [need(cache, "netIds")[i], need(cache, "lesserAngles")[i], need(cache, "greaterAngles")[i], need(cache, "layerMasks")[i]]),
        frontier: frontier ? { currentEpoch: own(workspace, "epoch") === own(queue, "closureEpochToken"), currentGeneration: own(workspace, "generation") === bestGeneration, retainedCount: retained.length, retained: retained.filter(p => selectedSet.has(p)) } : null,
      })
    }
    const portRows = selectedPorts.map(port => {
      const owners = [...ownersByPort.get(port)!]; owners.forEach(id => ownerIds.add(id))
      const endpoints = endpointOwnersByPort.get(port)!; endpoints.forEach(id => ownerIds.add(id))
      return [port, own(portMetadata[port], "serializedPortId") ?? null, portX[port], portY[port], portZ[port], sectionMask[port], reservations[port], assignments[port], own(problem, "portPenalty")?.[port] ?? 0, incidence[port], [angle1[port], angle2?.[port] ?? null], owners.slice(0, 8), owners.length, endpoints.slice(0, 8), endpoints.length]
    })
    const ownerRows = [...ownerIds].slice(0, 32).map(id => {
      const m = routeMetadata[id], section = own(m, "preloadedTraceSection")
      return [id, routeNet[id], own(m, "connectionId") ?? null, own(m, "mutuallyConnectedNetworkId") ?? null, own(problem, "routeIsFixed")?.[id] === 1, section ? [own(section, "traceId"), own(section, "startRoutePosition"), own(section, "endRoutePosition")] : null, need(solver, "routeAttemptCountByRouteId")[id], need(solver, "routeSuccessCountByRouteId")[id], [routeStarts[id], routeEnds[id]]]
    })
    const relevantNets = new Set<number>([routeNet[routeId], ...touchedRegions.map(id => regionNet[id]), ...selectedPorts.flatMap(id => [assignments[id], reservations[id]])])
    const netNames = new Map<number, string[]>()
    for (let id = 0; id < routeNet.length; id++) {
      const net = routeNet[id], name = own(routeMetadata[id], "mutuallyConnectedNetworkId")
      if (!relevantNets.has(net) || typeof name !== "string") continue
      const names = netNames.get(net) ?? []
      if (!names.includes(name)) names.push(name)
      netNames.set(net, names)
    }
    const packet: Obj = {
      version: 1, trigger, status: "observed", iterations: need(solver, "iterations"), maxIterations: need(solver, "MAX_ITERATIONS"),
      route: { id: routeId, connectionId: own(metadata, "connectionId"), name: own(connection, "name"), net: routeNet[routeId], currentNet: own(state, "currentRouteNetId"), canonicalNet: own(metadata, "mutuallyConnectedNetworkId"), rootNames: own(connection, "__rootConnectionNames") ?? null, endpointPorts, goal: need(state, "goalPortId"), terminals: own(connection, "pointsToConnect")?.slice(0, 2).map(point), attempts: need(solver, "routeAttemptCountByRouteId")[routeId], successes: need(solver, "routeSuccessCountByRouteId")[routeId] },
      realRegionIds, terminalRegionIds, generation: bestGeneration, heapGeneration: qGeneration,
      scoring: { minViaPadDiameter: own(solver, "minViaPadDiameter"), distanceToCost: own(solver, "DISTANCE_TO_COST"), traceDensityCostFactor: own(solver, "TRACE_DENSITY_COST_FACTOR") },
      netNames: [...netNames],
      queue: { length: items.length, first: candidate(items[0]) },
      regions: regionRows,
      adjacentRegions: touchedRegions.map(id => [id, own(regionMetadata[id], "serializedRegionId"), regionNet[id], layerMasks[id]]),
      portColumns: ["id", "serializedId", "x", "y", "z", "sectionMask", "reservationNet", "assignmentNet", "penalty", "incidentRegions", "anglesByIncidentSide", "committedOwnerRoutes", "committedOwnerCount", "endpointOwnerRoutes", "endpointOwnerCount"], ports: portRows,
      hopColumns: ["port", "nextRegion", "hop", "effectiveBestG", "storedBestGeneration", "closed", "queueIndex", "queuedCandidate"],
      candidateColumns: ["port", "nextRegion", "prevRegion", "g", "h", "f"],
      hops: selectedPorts.flatMap(port => incidence[port].map((region: number) => hopRow(port, region))),
      ownerColumns: ["route", "net", "connectionId", "canonicalNet", "fixed", "preloadTraceAndPositions", "attempts", "successes", "endpointPorts"], owners: ownerRows,
      totals: { ports: allSelectedPorts.length, owners: ownerIds.size },
      omissions: { ports: allSelectedPorts.length - selectedPorts.length, owners: ownerIds.size - ownerRows.length, byteLimit: false },
      interpretation: "Raw stored state, not a routing predicate result. Closed/dominated hops are not hard ownership blocks. The goal bypasses ordinary section-mask/opposite-region admission checks. Truncated neighborhoods cannot certify a cut.",
    }
    // Keep ordinary log forwarding bounded; truncation is explicit and invalidates a cut claim.
    while (Buffer.byteLength(JSON.stringify(packet)) > 23_500 && packet.ports.length > 2) {
      const removed = packet.ports.pop()[0]
      packet.hops = packet.hops.filter((row: any[]) => row[0] !== removed)
      for (const r of packet.regions) { r.ports = r.ports.filter((p: number) => p !== removed); if (r.frontier) r.frontier.retained = r.frontier.retained.filter((p: number) => p !== removed) }
      packet.omissions.ports++; packet.omissions.byteLimit = true
    }
    if (Buffer.byteLength(JSON.stringify(packet)) > 23_500) throw new Error("Selected packet exceeds byte budget even after port truncation")
    packet.complete = packet.omissions.ports === 0 && packet.omissions.owners === 0 && packet.ports.every((p: any[]) => p[11].length === p[12] && p[13].length === p[14]) && packet.regions.every((r: Obj) => r.segmentCount === r.segments.length && r.cacheSegmentCount === r.cacheSegments.length)
    return packet
  } catch (error) {
    return { version: 1, trigger, status: "observer-error", observerError: error instanceof Error ? error.message : String(error) }
  }
}
