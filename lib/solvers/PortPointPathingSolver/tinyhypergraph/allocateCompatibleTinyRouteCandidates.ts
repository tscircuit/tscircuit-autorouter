import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { createEmptyRegionIntersectionCache } from "tiny-hypergraph/lib/core"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"

type Segment = { region: number; route: number; from: number; to: number; net: number; lo: number; hi: number; mask: number; changes: number; length: number }
type Candidate = { segments: Segment[]; ports: Set<number>; key: string }
type Group = { net: number; candidates: Candidate[] }
type Score = { max: number; total: number; density: number; length: number; changes: number; singleLayerCrossings: number }
type RegionalTerm = { occupied: boolean; cost: number; density: number; singleLayerCrossings: number }
type RegionalContribution = { group: number; parts: Array<{ id: number; segments: Segment[] }>; variable: boolean }
type RegionalFactor = { region: number; contributions: RegionalContribution[]; variable: boolean; dirty: boolean; term?: RegionalTerm }
const MAX_REGIONAL_SCORE_CACHE_ENTRIES = 16_384
const MAX_REGIONAL_SCORE_CACHE_KEY_CHARACTERS = 1_048_576
export type JointCandidateAllocationStats = {
  jointCandidateAvailableBoards: number
  jointCandidateEligibleBoards: number
  jointCandidateTopologyMismatch: number
  jointCandidatePreloadedUnavailable: number
  jointCandidateNetGroups: number
  jointCandidateDistinctNetGroups: number
  jointCandidateTrials: number
  jointCandidateAcceptedExchanges: number
  jointCandidateSimultaneousExchanges: number
  jointCandidateHybridNetCount: number
  jointCandidateMixedBoards: number
  jointCandidateInitialDensity: number
  jointCandidateFinalDensity: number
  jointCandidatePreloadedLockedNetCount: number
  jointCandidateMasterStates: number
  jointCandidateMaximumExchangeSize: number
  jointCandidateDistinctCandidateCount: number
  jointCandidateScoredRegions: number
  jointCandidateScoredSegmentPairs: number
  jointCandidateAllocationElapsedMs: number
  jointCandidateMasterStateLimit: number
  jointCandidateMasterBudgetExhausted: number
  jointCandidateMasterComponents: number
  jointCandidateCompleteComponents: number
  jointCandidateComponentStates: number
  jointCandidateScoreCacheCapacity: number
  jointCandidateScoreCacheHits: number
  jointCandidateScoreCacheMisses: number
  jointCandidateScoreCacheEvictions: number
  jointCandidateScoreCacheOversizeKeys: number
  jointCandidateScoreCacheKeyParts: number
  jointCandidateScoreCacheKeyCharacters: number
  jointCandidateScoreIndexSegments: number
  jointCandidateScoreIndexChoices: number
  jointCandidateScoreIndexRetainedContributions: number
  jointCandidateScoreIndexRetainedChoices: number
  jointCandidateScoreIndexRetainedSegmentReferences: number
  jointCandidateScoreIndexRegions: number
  jointCandidateScoreIndexActiveRegions: number
  jointCandidateScoreConstantTerms: number
  jointCandidateScoreConstantReuses: number
  jointCandidateScoreCurrentTerms: number
  jointCandidateScoreCurrentReuses: number
  jointCandidateScoreDirtyChecks: number
  jointCandidateScoreDirtyFactors: number
  jointCandidateScoreChoiceComparisons: number
  jointCandidateScoreIndexRetainedInvalidationReferences: number
  jointCandidateScoreCachePeakEntries: number
  jointCandidateScoreCachePeakKeyCharacters: number
}

const sameNumbers = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/** Numeric IDs are usable only when topology, stable identities and route tables agree exactly. */
function haveIdenticalCandidateTopology(a: TinyHyperGraphSolver, b: TinyHyperGraphSolver): boolean {
  if (a.topology.portCount !== b.topology.portCount || a.topology.regionCount !== b.topology.regionCount || a.problem.routeCount !== b.problem.routeCount) return false
  for (const key of ["portX", "portY", "portZ", "portAngleForRegion1", "regionWidth", "regionHeight", "regionCenterX", "regionCenterY"] as const) {
    if (!sameNumbers(a.topology[key], b.topology[key])) return false
  }
  for (const key of ["regionAvailableZMask", "portAngleForRegion2"] as const) {
    const first = a.topology[key]
    const second = b.topology[key]
    if (Boolean(first) !== Boolean(second) || first && second && !sameNumbers(first, second)) return false
  }
  for (const key of ["incidentPortRegion", "regionIncidentPorts"] as const) {
    if (a.topology[key].some((list, i) => !sameNumbers(list, b.topology[key][i]!))) return false
  }
  for (let i = 0; i < a.topology.portCount; i++) {
    const first = a.topology.portMetadata?.[i]?.serializedPortId
    if (typeof first !== "string" || first !== b.topology.portMetadata?.[i]?.serializedPortId || JSON.stringify(a.topology.portMetadata?.[i]) !== JSON.stringify(b.topology.portMetadata?.[i])) return false
  }
  for (let i = 0; i < a.topology.regionCount; i++) {
    const first = a.topology.regionMetadata?.[i]?.serializedRegionId
    if (typeof first !== "string" || first !== b.topology.regionMetadata?.[i]?.serializedRegionId || JSON.stringify(a.topology.regionMetadata?.[i]) !== JSON.stringify(b.topology.regionMetadata?.[i])) return false
  }
  for (const key of ["routeStartPort", "routeEndPort", "routeNet", "regionNetId", "portSectionMask"] as const) {
    if (!sameNumbers(a.problem[key], b.problem[key])) return false
  }
  if (Boolean(a.problem.portPenalty) !== Boolean(b.problem.portPenalty) || a.problem.portPenalty && b.problem.portPenalty && !sameNumbers(a.problem.portPenalty, b.problem.portPenalty)) return false
  if (!sameNumbers(a.problemSetup.portEndpointReservationNetId, b.problemSetup.portEndpointReservationNetId)) return false
  for (let i = 0; i < a.problem.routeCount; i++) {
    const first = a.problem.routeMetadata?.[i]?.connectionId
    if (typeof first !== "string" || first !== b.problem.routeMetadata?.[i]?.connectionId || JSON.stringify(a.problem.routeMetadata?.[i]) !== JSON.stringify(b.problem.routeMetadata?.[i])) return false
  }
  if (JSON.stringify(a.problem.initialAssignments) !== JSON.stringify(b.problem.initialAssignments)) return false
  return true
}

function getCandidatesByNet(solver: TinyHyperGraphSolver): Map<number, Candidate> {
  const byNet = new Map<number, Candidate>()
  const routeAdjacency = Array.from({ length: solver.problem.routeCount }, () => new Map<number, number[]>())
  for (let route = 0; route < solver.problem.routeCount; route++) {
    const net = solver.problem.routeNet[route]!
    const candidate = byNet.get(net) ?? { segments: [], ports: new Set<number>(), key: "" }
    candidate.ports.add(solver.problem.routeStartPort[route]!)
    candidate.ports.add(solver.problem.routeEndPort[route]!)
    byNet.set(net, candidate)
  }
  for (let region = 0; region < solver.state.regionSegments.length; region++) {
    for (const [route, from, to] of solver.state.regionSegments[region]!) {
      const net = solver.problem.routeNet[route]!
      const candidate = byNet.get(net)
      if (!candidate) throw new Error("Joint allocation encountered an unknown route net")
      const reservedRegion = solver.problem.regionNetId[region]!
      if (reservedRegion !== -1 && reservedRegion !== net) throw new Error("Joint allocation candidate violates native region ownership")
      for (const port of [from, to]) {
        const reservedPort = solver.problemSetup.portEndpointReservationNetId[port] ?? -1
        if (!solver.topology.incidentPortRegion[port]?.includes(region) || reservedPort === -2 || reservedPort !== -1 && reservedPort !== net) throw new Error("Joint allocation candidate violates native port ownership or incidence")
      }
      const angle = (port: number): number => solver.topology.incidentPortRegion[port]![0] === region ? solver.topology.portAngleForRegion1[port]! : solver.topology.portAngleForRegion2?.[port] ?? solver.topology.portAngleForRegion1[port]!
      const first = angle(from)
      const second = angle(to)
      candidate.segments.push({ region, route, from, to, net, lo: Math.min(first, second), hi: Math.max(first, second), mask: (1 << solver.topology.portZ[from]!) | (1 << solver.topology.portZ[to]!), changes: Number(solver.topology.portZ[from] !== solver.topology.portZ[to]), length: Math.hypot(solver.topology.portX[from]! - solver.topology.portX[to]!, solver.topology.portY[from]! - solver.topology.portY[to]!) })
      candidate.ports.add(from)
      candidate.ports.add(to)
      const adjacency = routeAdjacency[route]!
      adjacency.set(from, [...(adjacency.get(from) ?? []), to])
      adjacency.set(to, [...(adjacency.get(to) ?? []), from])
    }
  }
  for (let route = 0; route < solver.problem.routeCount; route++) {
    const visited = new Set([solver.problem.routeStartPort[route]!])
    const queue = [...visited]
    for (let i = 0; i < queue.length; i++) {
      for (const next of routeAdjacency[route]!.get(queue[i]!) ?? []) {
        if (!visited.has(next)) { visited.add(next); queue.push(next) }
      }
    }
    if (!visited.has(solver.problem.routeEndPort[route]!) || [...routeAdjacency[route]!.keys()].some((port) => !visited.has(port))) throw new Error(`Joint allocation requires connected solved candidate route ${route}`)
  }
  for (const candidate of byNet.values()) candidate.key = candidate.segments.map((s) => `${s.region}:${s.route}:${Math.min(s.from, s.to)}:${Math.max(s.from, s.to)}`).sort().join("|")
  return byNet
}

function scoreSelection(groups: Group[], choices: number[], solver: TinyHyperGraphSolver, work: JointCandidateAllocationStats): Score | null {
  const owners = new Map<number, number>()
  const regions = Array.from({ length: solver.topology.regionCount }, () => [] as Segment[])
  let length = 0
  let changes = 0
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!
    const candidate = group.candidates[choices[i]!]!
    for (const port of candidate.ports) {
      const owner = owners.get(port)
      if (owner !== undefined && owner !== group.net) return null
      owners.set(port, group.net)
    }
    for (const segment of candidate.segments) { regions[segment.region]!.push(segment); length += segment.length; changes += segment.changes }
  }
  let max = 0
  let total = 0
  let density = 0
  let singleLayerCrossings = 0
  for (let region = 0; region < regions.length; region++) {
    const segments = regions[region]!
    if (segments.length === 0) continue
    work.jointCandidateScoredRegions++
    let same = 0
    let cross = 0
    let transitions = 0
    for (let i = 0; i < segments.length; i++) {
      const a = segments[i]!
      transitions += a.changes
      for (let j = 0; j < i; j++) {
        work.jointCandidateScoredSegmentPairs++
        const b = segments[j]!
        if (a.net === b.net || (a.lo < b.lo && b.lo < a.hi) === (a.lo < b.hi && b.hi < a.hi)) continue
        if ((a.mask & b.mask) !== 0) same++
        else cross++
      }
    }
    const mask = solver.topology.regionAvailableZMask?.[region] ?? 0
    if (mask > 0 && (mask & (mask - 1)) === 0) singleLayerCrossings += same
    const cost = computeRegionCost(solver.topology.regionWidth[region]!, solver.topology.regionHeight[region]!, same, cross, transitions, segments.length, mask, solver.minViaPadDiameter, 0)
    max = Math.max(max, cost)
    total += cost
    density += segments.length ** 2
  }
  if (![max, total, density, length, changes, singleLayerCrossings].every(Number.isFinite)) throw new Error("Joint candidate allocation encountered nonfinite solved geometry")
  return { max, total, density, length, changes, singleLayerCrossings }
}

/** Pure regional factors; ownership and global floating-point sums stay native. */
function createRegionalScoreCache(groups: Group[], solver: TinyHyperGraphSolver, work: JointCandidateAllocationStats, capacity: number): (choices: number[]) => Score | null {
  const index = Array.from({ length: solver.topology.regionCount }, () => [] as RegionalContribution[])
  work.jointCandidateScoreIndexRegions = index.length
  for (let group = 0; group < groups.length; group++) {
    const candidates = groups[group]!.candidates
    const byRegion = new Map<number, Array<Segment[] | undefined>>()
    for (let choice = 0; choice < candidates.length; choice++) {
      for (const segment of candidates[choice]!.segments) {
        const parts = byRegion.get(segment.region) ?? []
        const segments = parts[choice] ?? []
        segments.push(segment)
        parts[choice] = segments
        byRegion.set(segment.region, parts)
        work.jointCandidateScoreIndexSegments++
        work.jointCandidateScoreIndexRetainedSegmentReferences++
      }
    }
    for (const [region, parts] of byRegion) {
      const identities = new Map<string, number>([["", 0]])
      const contributions = candidates.map((_, choice) => {
        const segments = parts[choice] ?? []
        // Include ordered geometry and ownership, not a whole-board candidate
        // ID. Different global choices may have identical regional factors.
        const key = segments.map((s) => `${s.region}:${s.route}:${s.from}:${s.to}:${s.net}:${s.lo}:${s.hi}:${s.mask}:${s.changes}:${s.length}`).join("|")
        work.jointCandidateScoreCacheKeyParts += segments.length
        work.jointCandidateScoreCacheKeyCharacters += key.length
        let id = identities.get(key)
        if (id === undefined) { id = identities.size; identities.set(key, id) }
        work.jointCandidateScoreIndexChoices++
        work.jointCandidateScoreIndexRetainedChoices++
        return { id, segments }
      })
      work.jointCandidateScoreIndexRetainedContributions++
      index[region]!.push({ group, parts: contributions, variable: new Set(contributions.map((part) => part.id)).size > 1 })
    }
  }
  // Regions with no contribution in ANY candidate always add exactly zero.
  // Constant factors need one term per active region, with no LRU key work.
  // Both lists are input-proportional and counted independently of the LRU.
  const factors: RegionalFactor[] = index.flatMap((contributions, region) => contributions.length === 0 ? [] : [{ region, contributions, variable: contributions.some((contribution) => contribution.variable), dirty: true }])
  work.jointCandidateScoreIndexActiveRegions = factors.length
  const invalidation = Array.from({ length: groups.length }, () => [] as Array<{ factor: RegionalFactor; contribution: RegionalContribution }>)
  for (const factor of factors) for (const contribution of factor.contributions) {
    if (!contribution.variable) continue
    invalidation[contribution.group]!.push({ factor, contribution })
    work.jointCandidateScoreIndexRetainedInvalidationReferences++
  }
  const previousChoices = groups.map(() => -1)
  const cache = new Map<string, RegionalTerm>()
  let keyCharacters = 0
  const getTerm = (factor: RegionalFactor, choices: number[]): RegionalTerm => {
    const { region, contributions } = factor
    if (factor.term && !factor.dirty) {
      if (factor.variable) work.jointCandidateScoreCurrentReuses++
      else work.jointCandidateScoreConstantReuses++
      return factor.term
    }
    let key = ""
    if (factor.variable) {
      key = `${region}|`
      for (const contribution of contributions) {
        if (!contribution.variable) continue
        work.jointCandidateScoreCacheKeyParts++
        key += `${contribution.parts[choices[contribution.group]!]!.id},`
      }
      work.jointCandidateScoreCacheKeyCharacters += key.length
      const cached = cache.get(key)
      if (cached) {
        work.jointCandidateScoreCacheHits++
        cache.delete(key)
        cache.set(key, cached)
        if (!factor.term) work.jointCandidateScoreCurrentTerms++
        factor.term = cached
        factor.dirty = false
        return cached
      }
      work.jointCandidateScoreCacheMisses++
    }
    const segments: Segment[] = []
    // Contributor insertion is ascending group order; each list keeps the
    // original candidate segment order used by scoreSelection above.
    for (const contribution of contributions) for (const segment of contribution.parts[choices[contribution.group]!]!.segments) segments.push(segment)
    let same = 0, cross = 0, transitions = 0
    if (segments.length > 0) work.jointCandidateScoredRegions++
    for (let i = 0; i < segments.length; i++) {
      const a = segments[i]!
      transitions += a.changes
      for (let j = 0; j < i; j++) {
        work.jointCandidateScoredSegmentPairs++
        const b = segments[j]!
        if (a.net === b.net || (a.lo < b.lo && b.lo < a.hi) === (a.lo < b.hi && b.hi < a.hi)) continue
        if ((a.mask & b.mask) !== 0) same++
        else cross++
      }
    }
    const mask = solver.topology.regionAvailableZMask?.[region] ?? 0
    const term: RegionalTerm = { occupied: segments.length > 0,
      cost: segments.length === 0 ? 0 : computeRegionCost(solver.topology.regionWidth[region]!, solver.topology.regionHeight[region]!, same, cross, transitions, segments.length, mask, solver.minViaPadDiameter, 0),
      density: segments.length ** 2, singleLayerCrossings: mask > 0 && (mask & (mask - 1)) === 0 ? same : 0 }
    if (!factor.variable) {
      work.jointCandidateScoreConstantTerms++
      factor.term = term
      factor.dirty = false
      return term
    }
    if (!factor.term) work.jointCandidateScoreCurrentTerms++
    factor.term = term
    factor.dirty = false
    if (key.length > MAX_REGIONAL_SCORE_CACHE_KEY_CHARACTERS) {
      work.jointCandidateScoreCacheOversizeKeys++
      return term
    }
    while (cache.size >= capacity || keyCharacters + key.length > MAX_REGIONAL_SCORE_CACHE_KEY_CHARACTERS) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) throw new Error("Regional score cache accounting lost its oldest entry")
      cache.delete(oldest)
      keyCharacters -= oldest.length
      work.jointCandidateScoreCacheEvictions++
    }
    cache.set(key, term)
    keyCharacters += key.length
    work.jointCandidateScoreCachePeakEntries = Math.max(work.jointCandidateScoreCachePeakEntries, cache.size)
    work.jointCandidateScoreCachePeakKeyCharacters = Math.max(work.jointCandidateScoreCachePeakKeyCharacters, keyCharacters)
    return term
  }
  return (choices: number[]): Score | null => {
    const owners = new Map<number, number>()
    let length = 0, changes = 0
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!, candidate = group.candidates[choices[i]!]!
      for (const port of candidate.ports) {
        const owner = owners.get(port)
        if (owner !== undefined && owner !== group.net) return null
        owners.set(port, group.net)
      }
      // Do not pre-sum candidate lengths: changing this addition order changes
      // floating-point tie decisions, even when regional factors are exact.
      for (const segment of candidate.segments) { length += segment.length; changes += segment.changes }
    }
    // Invalid ownership states above must not advance this exact last-choice
    // witness. Only regional contributions whose local geometry changes become
    // dirty; different whole-net choices can have identical local geometry.
    for (let group = 0; group < groups.length; group++) {
      work.jointCandidateScoreChoiceComparisons++
      const previous = previousChoices[group]!, choice = choices[group]!
      if (previous === choice) continue
      for (const { factor, contribution } of invalidation[group]!) {
        work.jointCandidateScoreDirtyChecks++
        if (previous !== -1 && contribution.parts[previous]!.id === contribution.parts[choice]!.id) continue
        if (!factor.dirty) work.jointCandidateScoreDirtyFactors++
        factor.dirty = true
      }
      previousChoices[group] = choice
    }
    let max = 0, total = 0, density = 0, singleLayerCrossings = 0
    for (const factor of factors) {
      const term = getTerm(factor, choices)
      if (!term.occupied) continue
      singleLayerCrossings += term.singleLayerCrossings
      max = Math.max(max, term.cost)
      total += term.cost
      density += term.density
    }
    if (![max, total, density, length, changes, singleLayerCrossings].every(Number.isFinite)) throw new Error("Joint candidate allocation encountered nonfinite solved geometry")
    return { max, total, density, length, changes, singleLayerCrossings }
  }
}

function getNativePressure(solver: TinyHyperGraphSolver): { max: number; total: number } {
  let max = 0
  let total = 0
  for (let region = 0; region < solver.topology.regionCount; region++) {
    const cache = solver.state.regionIntersectionCaches[region]!
    if (cache.existingSegmentCount === 0) continue
    const cost = computeRegionCost(solver.topology.regionWidth[region]!, solver.topology.regionHeight[region]!, cache.existingSameLayerIntersections, cache.existingCrossingLayerIntersections, cache.existingEntryExitLayerChanges, cache.existingSegmentCount, solver.topology.regionAvailableZMask?.[region] ?? 0, solver.minViaPadDiameter, 0)
    max = Math.max(max, cost)
    total += cost
  }
  if (!Number.isFinite(max) || !Number.isFinite(total)) throw new Error("Joint allocation native pressure is nonfinite")
  return { max, total }
}

/** Joint allocation over complete whole-net alternatives from native rounds.
 * Physical preload owners are locked to the final native candidate; other nets
 * may exchange arbitrary conflict-connected chains, not just one/two flips.
 */
export function allocateCompatibleTinyRouteCandidates(baseline: TinyHyperGraphSolver, alternative: TinyHyperGraphSolver | TinyHyperGraphSolver[], provenance: { hasPreloadedCopper: boolean; regionalScoreCacheCapacity?: number }): JointCandidateAllocationStats {
  const stats: JointCandidateAllocationStats = { jointCandidateAvailableBoards: 1, jointCandidateEligibleBoards: 0, jointCandidateTopologyMismatch: 0, jointCandidatePreloadedUnavailable: 0, jointCandidateNetGroups: 0, jointCandidateDistinctNetGroups: 0, jointCandidateTrials: 0, jointCandidateAcceptedExchanges: 0, jointCandidateSimultaneousExchanges: 0, jointCandidateHybridNetCount: 0, jointCandidateMixedBoards: 0, jointCandidateInitialDensity: 0, jointCandidateFinalDensity: 0, jointCandidatePreloadedLockedNetCount: 0, jointCandidateMasterStates: 0, jointCandidateMaximumExchangeSize: 0, jointCandidateDistinctCandidateCount: 0, jointCandidateScoredRegions: 0, jointCandidateScoredSegmentPairs: 0, jointCandidateAllocationElapsedMs: 0, jointCandidateMasterStateLimit: 8192, jointCandidateMasterBudgetExhausted: 0, jointCandidateMasterComponents: 0, jointCandidateCompleteComponents: 0, jointCandidateComponentStates: 0, jointCandidateScoreCacheCapacity: 0, jointCandidateScoreCacheHits: 0, jointCandidateScoreCacheMisses: 0, jointCandidateScoreCacheEvictions: 0, jointCandidateScoreCacheOversizeKeys: 0, jointCandidateScoreCacheKeyParts: 0, jointCandidateScoreCacheKeyCharacters: 0, jointCandidateScoreIndexSegments: 0, jointCandidateScoreIndexChoices: 0, jointCandidateScoreIndexRetainedContributions: 0, jointCandidateScoreIndexRetainedChoices: 0, jointCandidateScoreIndexRetainedSegmentReferences: 0, jointCandidateScoreIndexRegions: 0, jointCandidateScoreIndexActiveRegions: 0, jointCandidateScoreConstantTerms: 0, jointCandidateScoreConstantReuses: 0, jointCandidateScoreCurrentTerms: 0, jointCandidateScoreCurrentReuses: 0, jointCandidateScoreDirtyChecks: 0, jointCandidateScoreDirtyFactors: 0, jointCandidateScoreChoiceComparisons: 0, jointCandidateScoreIndexRetainedInvalidationReferences: 0, jointCandidateScoreCachePeakEntries: 0, jointCandidateScoreCachePeakKeyCharacters: 0 }
  const capacity = provenance.regionalScoreCacheCapacity ?? MAX_REGIONAL_SCORE_CACHE_ENTRIES
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > MAX_REGIONAL_SCORE_CACHE_ENTRIES) throw new Error("Regional score cache capacity must be an integer within its explicit bound")
  stats.jointCandidateScoreCacheCapacity = capacity
  const startedAt = performance.now()
  try {
  if (!baseline.solved || baseline.failed) throw new Error("Joint allocation requires a completed native baseline")
  const alternatives = Array.isArray(alternative) ? alternative : [alternative]
  if (alternatives.some((candidate) => !candidate.solved || candidate.failed)) throw new Error("Joint allocation requires complete native alternatives")
  if (alternatives.some((candidate) => !haveIdenticalCandidateTopology(baseline, candidate))) { stats.jointCandidateTopologyMismatch++; return stats }
  const first = getCandidatesByNet(baseline)
  const otherCandidates = alternatives.map(getCandidatesByNet)
  // Actual physical sections are identifiable independently of reconstructed
  // ordinary initial assignments. Keep every route of their electrical net
  // byte-for-byte in its final native state, so allocation cannot move copper.
  const pinnedNets = new Set<number>()
  baseline.problem.routeMetadata?.forEach((metadata, route) => {
    if (metadata?.preloadedTraceSection) pinnedNets.add(baseline.problem.routeNet[route]!)
  })
  stats.jointCandidatePreloadedLockedNetCount = pinnedNets.size
  const groups: Group[] = [...first].map(([net, candidate]) => {
    const candidates = [candidate]
    if (!pinnedNets.has(net)) {
      for (const other of otherCandidates) {
        const value = other.get(net)
        if (!value) throw new Error("Joint candidate allocation lost an electrical net")
        if (!candidates.some((existing) => existing.key === value.key)) candidates.push(value)
      }
    }
    return { net, candidates }
  })
  stats.jointCandidateEligibleBoards = 1
  stats.jointCandidateNetGroups = groups.length
  stats.jointCandidateDistinctNetGroups = groups.filter((g) => g.candidates.length > 1).length
  stats.jointCandidateDistinctCandidateCount = groups.reduce((sum, g) => sum + g.candidates.length, 0)
  const scoreCandidates = capacity === 0 ? (selection: number[]): Score | null => scoreSelection(groups, selection, baseline, stats) : createRegionalScoreCache(groups, baseline, stats, capacity)
  let choices = groups.map(() => 0)
  const original = scoreCandidates(choices)
  if (!original) throw new Error("Joint allocation baseline violates shared-port ownership")
  const nativePressure = getNativePressure(baseline)
  const maximumPressure = Math.min(original.max, nativePressure.max)
  const totalPressure = Math.min(original.total, nativePressure.total)
  let current = original
  stats.jointCandidateInitialDensity = original.density
  const isBetter = (score: Score, previous: Score): boolean => score.max < previous.max - 1e-9 || Math.abs(score.max - previous.max) <= 1e-9 && (score.total < previous.total - 1e-9 || Math.abs(score.total - previous.total) <= 1e-9 && (score.density < previous.density || score.density === previous.density && (score.changes < previous.changes || score.changes === previous.changes && score.length < previous.length - 1e-7)))
  // The master has its own explicit finite work allowance. Native route search
  // budgets and completed solutions are unchanged. Every visited assignment,
  // including rejected ownership states, is charged and exported as evidence.
  const maximumMasterStates = 4096
  for (let sweep = 0; sweep < 3 && stats.jointCandidateMasterStates < maximumMasterStates; sweep++) {
    let improved = false
    for (let seed = 0; seed < groups.length; seed++) {
      for (let candidateIndex = 0; candidateIndex < groups[seed]!.candidates.length; candidateIndex++) {
        if (candidateIndex === choices[seed] || stats.jointCandidateMasterStates >= maximumMasterStates) continue
        const proposed = [...choices]
        proposed[seed] = candidateIndex
        const visited = new Set<string>()
        let bestChoices: number[] | undefined
        let bestScore = current
        const repairOwnership = (selection: number[], changed: Set<number>): void => {
          if (stats.jointCandidateMasterStates >= maximumMasterStates) return
          const key = selection.join(",")
          if (visited.has(key)) return
          visited.add(key)
          stats.jointCandidateMasterStates++
          const owner = new Map<number, number>()
          let conflict: [number, number] | undefined
          for (let i = 0; i < groups.length && !conflict; i++) {
            for (const port of groups[i]!.candidates[selection[i]!]!.ports) {
              const other = owner.get(port)
              if (other !== undefined && other !== i) { conflict = [other, i]; break }
              owner.set(port, i)
            }
          }
          if (conflict) {
            const [a, b] = conflict
            if (changed.has(a) && changed.has(b)) return
            const blocker = changed.has(a) ? b : a
            for (let index = 0; index < groups[blocker]!.candidates.length; index++) {
              if (index === selection[blocker]) continue
              const next = [...selection]
              next[blocker] = index
              repairOwnership(next, new Set([...changed, blocker]))
            }
            return
          }
          stats.jointCandidateTrials++
          const score = scoreCandidates(selection)
          if (!score) throw new Error("Joint master ownership proof disagrees with physical candidate scoring")
          if (score.singleLayerCrossings > original.singleLayerCrossings || score.max > maximumPressure + 1e-9 || score.total > totalPressure + 1e-9 || !isBetter(score, bestScore)) return
          bestChoices = selection
          bestScore = score
        }
        repairOwnership(proposed, new Set([seed]))
        if (!bestChoices) continue
        const changedCount = choices.filter((choice, i) => choice !== bestChoices![i]).length
        choices = bestChoices
        current = bestScore
        improved = true
        stats.jointCandidateAcceptedExchanges++
        if (changedCount > 1) stats.jointCandidateSimultaneousExchanges++
        stats.jointCandidateMaximumExchangeSize = Math.max(stats.jointCandidateMaximumExchangeSize, changedCount)
      }
    }
    if (!improved) break
  }
  // A conflict-chain primal is fast, but cannot cross pressure barriers when
  // independent portals need to change together. Enumerate finite whole-net
  // candidate domains within components coupled by ANY possible region/port.
  // Components share no regional terms or ownership constraints, but the
  // global max/total objective still couples their choices. Completion means
  // exhaustive conditional enumeration with other components fixed, not a
  // globally optimal master or globally optimal detailed routing.
  const mutable = groups.flatMap((group, i) => group.candidates.length > 1 ? [i] : [])
  const parent = groups.map((_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]! }
    return i
  }
  const incidence = new Map<string, number>()
  for (const i of mutable) {
    for (const candidate of groups[i]!.candidates) {
      const keys = [...candidate.ports].map((port) => `p${port}`)
      keys.push(...candidate.segments.map((segment) => `r${segment.region}`))
      for (const key of keys) {
        const other = incidence.get(key)
        if (other === undefined) incidence.set(key, i)
        else parent[root(i)] = root(other)
      }
    }
  }
  const components = new Map<number, number[]>()
  for (const i of mutable) {
    const id = root(i)
    const component = components.get(id) ?? []
    component.push(i)
    components.set(id, component)
  }
  stats.jointCandidateMasterComponents = components.size
  let remainingComponents = components.size
  for (const component of components.values()) {
    const componentSet = new Set(component)
    const owners = new Map<number, number>()
    for (let i = 0; i < groups.length; i++) {
      if (componentSet.has(i)) continue
      for (const port of groups[i]!.candidates[choices[i]!]!.ports) owners.set(port, i)
    }
    const order = [...component].sort((a, b) => groups[a]!.candidates.length - groups[b]!.candidates.length || a - b)
    const quota = Math.floor((8192 - stats.jointCandidateMasterStates) / remainingComponents--)
    let visitedStates = 0, complete = true
    const selection = [...choices]
    let bestChoices = choices, bestScore = current
    const enumerate = (depth: number): void => {
      if (visitedStates >= quota) { complete = false; return }
      visitedStates++
      stats.jointCandidateMasterStates++
      stats.jointCandidateComponentStates++
      if (depth === order.length) {
        stats.jointCandidateTrials++
        const score = scoreCandidates(selection)
        if (!score) throw new Error("Finite candidate master ownership proof disagrees with scoring")
        if (score.singleLayerCrossings <= original.singleLayerCrossings && score.max <= maximumPressure + 1e-9 && score.total <= totalPressure + 1e-9 && isBetter(score, bestScore)) {
          bestChoices = [...selection]
          bestScore = score
        }
        return
      }
      const groupIndex = order[depth]!
      const indices = groups[groupIndex]!.candidates.map((_, i) => i)
      indices.sort((a, b) => Number(b === choices[groupIndex]) - Number(a === choices[groupIndex]) || a - b)
      for (const index of indices) {
        const candidate = groups[groupIndex]!.candidates[index]!
        if ([...candidate.ports].some((port) => owners.has(port))) continue
        for (const port of candidate.ports) owners.set(port, groupIndex)
        selection[groupIndex] = index
        enumerate(depth + 1)
        for (const port of candidate.ports) owners.delete(port)
        if (!complete) break
      }
    }
    enumerate(0)
    if (complete) stats.jointCandidateCompleteComponents++
    if (bestChoices !== choices) {
      const changedCount = choices.filter((choice, i) => choice !== bestChoices[i]).length
      choices = bestChoices
      current = bestScore
      stats.jointCandidateAcceptedExchanges++
      if (changedCount > 1) stats.jointCandidateSimultaneousExchanges++
      stats.jointCandidateMaximumExchangeSize = Math.max(stats.jointCandidateMaximumExchangeSize, changedCount)
    }
  }
  stats.jointCandidateMasterBudgetExhausted = Number(stats.jointCandidateCompleteComponents < stats.jointCandidateMasterComponents)
  stats.jointCandidateHybridNetCount = choices.filter((c) => c !== 0).length
  stats.jointCandidateMixedBoards = Number(stats.jointCandidateHybridNetCount > 0 && stats.jointCandidateHybridNetCount < groups.length)
  stats.jointCandidateFinalDensity = current.density
  if (stats.jointCandidateAcceptedExchanges === 0) return stats
  // Publish a complete solved state. Rerip hooks may restore initial assignments
  // from a previous candidate, which must not be appended to this hybrid.
  baseline.state.portAssignment.fill(-1)
  baseline.state.regionSegments = Array.from({ length: baseline.topology.regionCount }, () => [])
  baseline.state.regionIntersectionCaches = Array.from({ length: baseline.topology.regionCount }, () => createEmptyRegionIntersectionCache())
  baseline.state.candidateQueue.clear()
  baseline.state.goalPortId = -1
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!
    const candidate = group.candidates[choices[i]!]!
    for (const port of candidate.ports) baseline.state.portAssignment[port] = group.net
    for (const s of candidate.segments) {
      baseline.state.currentRouteNetId = group.net
      baseline.state.regionSegments[s.region]!.push([s.route, s.from, s.to])
      baseline.appendSegmentToRegionCache(s.region, s.from, s.to)
    }
  }
  baseline.state.unroutedRoutes = []
  baseline.state.currentRouteId = undefined
  baseline.state.currentRouteNetId = undefined
  const acceptedPressure = getNativePressure(baseline)
  if (acceptedPressure.max > maximumPressure + 1e-9 || acceptedPressure.total > totalPressure + 1e-9) throw new Error("Joint candidate replay violated its native pressure constraint")
  return stats
  } finally {
    stats.jointCandidateAllocationElapsedMs = performance.now() - startedAt
  }
}
