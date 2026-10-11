import { TinyHyperGraphSolver, getTinyHyperGraphSolverOptions, type TinyHyperGraphInitialAssignment } from "tiny-hypergraph/lib/core"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"
import { countNewIntersectionsWithValues } from "tiny-hypergraph/lib/countNewIntersections"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"

import type { IndependentRouteSegment } from "./DuplicateCongestedPortSolverWithIndependentRoutes"

type Strand = { sourcePortId: number; selectedPortId: number; locked: boolean; boundaryKey: string }
type Segment = { routeId: number; regionId: number; from: Strand; to: Strand }
type NetBlock = { netId: number; routeIds: number[]; segments: Segment[]; strands: Strand[]; upstreamIndex: number }
type ProjectedRegion = { regionId: number; same: number; cross: number; changes: number; traceCount: number; cost: number }
type Score = { excess: number; vias: number; cost: number; length: number; regions: ProjectedRegion[] }
type PlannedBlock = { block: NetBlock; score: Score; assignments: TinyHyperGraphInitialAssignment[] }

export type ColdBoundarySeedStats = {
  initialColdSeedRouteCount: number
  initialColdSeedNetCount: number
  initialColdSeedAssignmentCount: number
  initialColdSeedPendingRouteCount: number
  initialColdSeedEstimatedVias: number
  initialColdSeedRegionCost: number
  initialColdSeedMaxRegionCost: number
  initialColdSeedElapsedMs: number
}

/**
 * Seed a planar, zero-transition backbone; leave competing net blocks pending.
 * Native boundary slots and actual committed crossings determine eligibility.
 * The existing initial rip threshold bounds every added region's congestion.
 * Whole net blocks are selected by minimum incremental estimated vias.
 */
export const initializePlanarBoundarySeed = (
  solver: TinyHyperGraphSolver,
  independentRoutes: readonly IndependentRouteSegment[],
  routeSuccessCountByRouteId: Uint32Array,
): ColdBoundarySeedStats => {
  const started = performance.now()
  const { topology, problem, state } = solver
  if (solver.iterations !== 0 || state.ripCount !== 0 || state.currentRouteId !== undefined) {
    throw new Error("Cold boundary seeding requires an unstarted solver")
  }
  if (routeSuccessCountByRouteId.length !== problem.routeCount) throw new Error("Cold seed counter size mismatch")
  const routeById = new Map<string, number>()
  const portById = new Map<string, number>()
  const regionById = new Map<string, number>()
  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    const id = problem.routeMetadata?.[routeId]?.connectionId
    if (typeof id !== "string" || routeById.has(id)) throw new Error(`Missing or repeated connection ID for route ${routeId}`)
    routeById.set(id, routeId)
  }
  for (let portId = 0; portId < topology.portCount; portId++) {
    const id = topology.portMetadata?.[portId]?.serializedPortId
    if (typeof id !== "string" || portById.has(id)) throw new Error(`Missing or repeated port ID ${portId}`)
    portById.set(id, portId)
  }
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const id = topology.regionMetadata?.[regionId]?.serializedRegionId
    if (typeof id !== "string" || regionById.has(id)) throw new Error(`Missing or repeated region ID ${regionId}`)
    regionById.set(id, regionId)
  }
  const endpointOwner = new Int32Array(topology.portCount).fill(-1)
  for (let routeId = 0; routeId < problem.routeCount; routeId++) {
    for (const portId of [problem.routeStartPort[routeId]!, problem.routeEndPort[routeId]!]) {
      const netId = problem.routeNet[routeId]!
      if ((endpointOwner[portId] !== -1 && endpointOwner[portId] !== netId) ||
        (state.portAssignment[portId] !== -1 && state.portAssignment[portId] !== netId)) {
        throw new Error(`Cold seed endpoint ${portId} has conflicting ownership`)
      }
      endpointOwner[portId] = netId
    }
  }
  const boundaryKeyByPort: string[] = []
  const nativePortsByBoundary = new Map<string, number[]>()
  for (let portId = 0; portId < topology.portCount; portId++) {
    const regions = [...topology.incidentPortRegion[portId]!].sort((a, b) => a - b)
    if (regions.length === 0 || regions.length > 2 || new Set(regions).size !== regions.length) {
      throw new Error(`Cold seed port ${portId} has invalid incidence`)
    }
    const key = regions.length === 2 ? `${regions[0]}:${regions[1]}:${topology.portZ[portId]}` : `terminal:${portId}`
    boundaryKeyByPort[portId] = key
    // Duplicated/cramped ports express expensive artificial capacity. A cold
    // feasible backbone uses only native, unpenalized slots.
    if (problem.portSectionMask[portId] !== 1 || topology.portMetadata?.[portId]?.duplicatedFromPortId !== undefined ||
      (problem.portPenalty?.[portId] ?? 0) !== 0) continue
    const ports = nativePortsByBoundary.get(key) ?? []
    ports.push(portId)
    nativePortsByBoundary.set(key, ports)
  }
  const pending = new Set(state.unroutedRoutes)
  const blocks = new Map<number, NetBlock>()
  for (let upstreamIndex = 0; upstreamIndex < state.unroutedRoutes.length; upstreamIndex++) {
    const routeId = state.unroutedRoutes[upstreamIndex]!
    const netId = problem.routeNet[routeId]!
    let block = blocks.get(netId)
    if (!block) {
      block = { netId, routeIds: [], segments: [], strands: [], upstreamIndex }
      blocks.set(netId, block)
    }
    block.routeIds.push(routeId)
  }
  const strandsBySourceAndNet = new Map<string, Strand>()
  const routesWithSegments = new Set<number>()
  for (const captured of independentRoutes) {
    const routeId = routeById.get(captured.connectionId)
    if (routeId === undefined) throw new Error(`Cold seed has an unknown connection "${captured.connectionId}"`)
    if (!pending.has(routeId)) continue
    const regionId = regionById.get(captured.regionId)
    const netId = problem.routeNet[routeId]!
    if (regionId === undefined || (problem.regionNetId[regionId] !== -1 && problem.regionNetId[regionId] !== netId)) {
      throw new Error(`Cold seed route "${captured.connectionId}" references a missing or foreign region`)
    }
    const block = blocks.get(netId)!
    const ends: Strand[] = []
    for (const id of [captured.fromPortId, captured.toPortId]) {
      const sourcePortId = portById.get(id)
      if (sourcePortId === undefined || !topology.incidentPortRegion[sourcePortId]!.includes(regionId)) {
        throw new Error(`Cold seed route "${captured.connectionId}" has a missing or nonincident port`)
      }
      const key = `${sourcePortId}:${netId}`
      let strand = strandsBySourceAndNet.get(key)
      if (!strand) {
        strand = {
          sourcePortId,
          selectedPortId: sourcePortId,
          locked: topology.incidentPortRegion[sourcePortId]!.length === 1 || endpointOwner[sourcePortId] === netId || state.portAssignment[sourcePortId] === netId,
          boundaryKey: boundaryKeyByPort[sourcePortId]!,
        }
        strandsBySourceAndNet.set(key, strand)
        block.strands.push(strand)
      }
      ends.push(strand)
    }
    block.segments.push({ routeId, regionId, from: ends[0]!, to: ends[1]! })
    routesWithSegments.add(routeId)
  }
  // Validate original chains before selection. Connectedness must never depend
  // on whether an otherwise invalid candidate was rejected by a cost bound.
  const originalAssignments = [...blocks.values()].flatMap((block) => block.segments.map((segment): TinyHyperGraphInitialAssignment => ({
    routeId: segment.routeId, regionId: segment.regionId, fromPortId: segment.from.sourcePortId, toPortId: segment.to.sourcePortId,
  })))
  for (const routeId of pending) {
    if (!routesWithSegments.has(routeId) && problem.routeStartPort[routeId] !== problem.routeEndPort[routeId]) {
      throw new Error(`Cold seed has no complete independent path for route ${routeId}`)
    }
    const assignments = originalAssignments.filter((assignment) => assignment.routeId === routeId)
    const adjacency = new Map<number, Set<number>>()
    for (const { fromPortId, toPortId } of assignments) {
      const fromNeighbors = adjacency.get(fromPortId) ?? new Set<number>()
      const toNeighbors = adjacency.get(toPortId) ?? new Set<number>()
      fromNeighbors.add(toPortId); toNeighbors.add(fromPortId)
      adjacency.set(fromPortId, fromNeighbors); adjacency.set(toPortId, toNeighbors)
    }
    const visited = new Set<number>()
    const queue = [problem.routeStartPort[routeId]!]
    while (queue.length > 0) {
      const portId = queue.pop()!
      if (visited.has(portId)) continue
      visited.add(portId)
      queue.push(...(adjacency.get(portId) ?? []))
    }
    if (!visited.has(problem.routeEndPort[routeId]!) || [...adjacency.keys()].some((portId) => !visited.has(portId))) {
      throw new Error(`Cold seed independent path for route ${routeId} does not connect its exact endpoints`)
    }
  }
  const ValidationSolver = solver.constructor as typeof TinyHyperGraphSolver
  const working = new ValidationSolver(topology, problem, { ...getTinyHyperGraphSolverOptions(solver), STATIC_REACHABILITY_PRECHECK: false })
  working.state = {
    ...state,
    portAssignment: new Int32Array(state.portAssignment),
    regionSegments: state.regionSegments.map((segments) => [...segments]),
    regionIntersectionCaches: structuredClone(state.regionIntersectionCaches),
    currentRouteNetId: undefined,
    unroutedRoutes: [...state.unroutedRoutes],
  }
  const workingCounter = new Uint32Array(routeSuccessCountByRouteId)
  const caps = state.regionIntersectionCaches.map((cache) => Math.max(cache.existingRegionCost, solver.RIP_THRESHOLD_START))
  const selected: TinyHyperGraphInitialAssignment[] = []
  const selectedBlocks = new Set<number>()
  let estimatedVias = 0
  const evaluate = (block: NetBlock): Score => {
    const increments = new Map<number, { same: number; cross: number; changes: number; count: number }>()
    let length = 0
    for (const segment of block.segments) {
      const a = segment.from.selectedPortId
      const b = segment.to.selectedPortId
      const angleA = topology.incidentPortRegion[a]![0] === segment.regionId ? topology.portAngleForRegion1[a]! : topology.portAngleForRegion2![a]!
      const angleB = topology.incidentPortRegion[b]![0] === segment.regionId ? topology.portAngleForRegion1[b]! : topology.portAngleForRegion2![b]!
      const cache = working.state.regionIntersectionCaches[segment.regionId]!
      const [same, cross, changes] = countNewIntersectionsWithValues(cache, block.netId, Math.min(angleA, angleB), Math.max(angleA, angleB), (1 << topology.portZ[a]!) | (1 << topology.portZ[b]!), topology.portZ[a] !== topology.portZ[b] ? 1 : 0)
      const increment = increments.get(segment.regionId) ?? { same: 0, cross: 0, changes: 0, count: 0 }
      increment.same += same; increment.cross += cross; increment.changes += changes; increment.count++
      increments.set(segment.regionId, increment)
      length += Math.hypot(topology.portX[a]! - topology.portX[b]!, topology.portY[a]! - topology.portY[b]!)
    }
    const score: Score = { excess: 0, vias: 0, cost: 0, length, regions: [] }
    for (const [regionId, increment] of increments) {
      const cache = working.state.regionIntersectionCaches[regionId]!
      const same = cache.existingSameLayerIntersections + increment.same
      const cross = cache.existingCrossingLayerIntersections + increment.cross
      const changes = cache.existingEntryExitLayerChanges + increment.changes
      const traceCount = cache.existingSegmentCount + increment.count
      // The full rectangular Stable/Selective scope uses this exported native
      // kernel; append/validation still use the same solver class and options.
      const cost = computeRegionCost(
        topology.regionWidth[regionId]!,
        topology.regionHeight[regionId]!,
        same,
        cross,
        changes,
        traceCount,
        topology.regionAvailableZMask?.[regionId] ?? 0,
        working.minViaPadDiameter,
        working.TRACE_DENSITY_COST_FACTOR,
      )
      if (!Number.isFinite(cost)) throw new Error(`Cold seed has a nonfinite projected cost in region ${regionId}`)
      score.excess += Math.max(0, cost - caps[regionId]!)
      score.vias += 2 * increment.same + increment.cross + increment.changes
      score.cost += cost - cache.existingRegionCost
      score.regions.push({ regionId, same, cross, changes, traceCount, cost })
    }
    return score
  }
  const improves = (a: Score, b: Score): boolean => {
    for (const key of ["excess", "vias", "cost", "length"] as const) {
      if (a[key] + 1e-9 < b[key]) return true
      if (b[key] + 1e-9 < a[key]) return false
    }
    return false
  }
  const plan = (block: NetBlock): PlannedBlock | undefined => {
    // A zero-segment branch remains for ordinary routing. Never mark a whole
    // net seeded when one of its pending branches lacks actual assignments.
    if (block.routeIds.some((routeId) => !routesWithSegments.has(routeId))) return undefined
    const claimed = new Set<number>()
    const legalPorts = (strand: Strand): number[] => (nativePortsByBoundary.get(strand.boundaryKey) ?? []).filter((portId) =>
      !claimed.has(portId) && (endpointOwner[portId] === -1 || (strand.locked && portId === strand.sourcePortId && endpointOwner[portId] === block.netId)) &&
      (working.state.portAssignment[portId] === -1 || (strand.locked && portId === strand.sourcePortId && working.state.portAssignment[portId] === block.netId)),
    )
    for (const strand of block.strands.filter((entry) => entry.locked)) {
      if (!legalPorts(strand).includes(strand.sourcePortId)) return undefined
      strand.selectedPortId = strand.sourcePortId
      claimed.add(strand.selectedPortId)
    }
    for (const strand of block.strands.filter((entry) => !entry.locked)) {
      const ports = legalPorts(strand)
      const portId = ports.includes(strand.sourcePortId) ? strand.sourcePortId : ports[0]
      if (portId === undefined) return undefined
      strand.selectedPortId = portId
      claimed.add(portId)
    }
    let score = evaluate(block)
    let improved = true
    while (improved) {
      improved = false
      for (const strand of block.strands) {
        if (strand.locked) continue
        for (const targetPortId of nativePortsByBoundary.get(strand.boundaryKey) ?? []) {
          if (targetPortId === strand.selectedPortId || endpointOwner[targetPortId] !== -1 || working.state.portAssignment[targetPortId] !== -1) continue
          const other = block.strands.find((entry) => entry.selectedPortId === targetPortId)
          if (other?.locked) continue
          const previous = strand.selectedPortId
          strand.selectedPortId = targetPortId
          if (other) other.selectedPortId = previous
          const next = evaluate(block)
          if (improves(next, score)) { score = next; improved = true }
          else { strand.selectedPortId = previous; if (other) other.selectedPortId = targetPortId }
        }
      }
    }
    if (score.excess > 1e-9 || score.vias !== 0) return undefined
    return { block, score, assignments: block.segments.map((segment) => ({ routeId: segment.routeId, regionId: segment.regionId, fromPortId: segment.from.selectedPortId, toPortId: segment.to.selectedPortId })) }
  }
  while (selectedBlocks.size < blocks.size) {
    let best: PlannedBlock | undefined
    for (const block of blocks.values()) {
      if (selectedBlocks.has(block.netId)) continue
      const candidate = plan(block)
      if (!candidate) continue
      if (!best || improves(candidate.score, best.score) ||
        (!improves(best.score, candidate.score) && candidate.block.upstreamIndex < best.block.upstreamIndex)) best = candidate
    }
    if (!best) break
    applyInitialAssignments({ topology, problem: { ...problem, initialAssignments: best.assignments }, state: working.state, routeSuccessCountByRouteId: workingCounter, appendSegmentToRegionCache: (regionId, a, b): void => working.appendSegmentToRegionCache(regionId, a, b) })
    for (const projected of best.score.regions) {
      const actual = working.state.regionIntersectionCaches[projected.regionId]!.existingRegionCost
      if (!Number.isFinite(actual) || Math.abs(actual - projected.cost) > 1e-7 || actual > caps[projected.regionId]! + 1e-9) {
        throw new Error(`Cold seed projection disagrees with actual cache in region ${projected.regionId}`)
      }
    }
    selected.push(...best.assignments)
    selectedBlocks.add(best.block.netId)
    estimatedVias += best.score.vias
  }
  applyInitialAssignments({ topology, problem: { ...problem, initialAssignments: selected }, state, routeSuccessCountByRouteId, appendSegmentToRegionCache: (regionId, a, b): void => solver.appendSegmentToRegionCache(regionId, a, b) })
  const costs = state.regionIntersectionCaches.map((cache) => cache.existingRegionCost)
  const stats: ColdBoundarySeedStats = {
    initialColdSeedRouteCount: new Set(selected.map((assignment) => assignment.routeId)).size,
    initialColdSeedNetCount: selectedBlocks.size,
    initialColdSeedAssignmentCount: selected.length,
    initialColdSeedPendingRouteCount: state.unroutedRoutes.length,
    initialColdSeedEstimatedVias: estimatedVias,
    initialColdSeedRegionCost: costs.reduce((sum, cost) => sum + cost, 0),
    initialColdSeedMaxRegionCost: costs.reduce((max, cost) => Math.max(max, cost), 0),
    initialColdSeedElapsedMs: performance.now() - started,
  }
  solver.stats = { ...solver.stats, ...stats }
  return stats
}
