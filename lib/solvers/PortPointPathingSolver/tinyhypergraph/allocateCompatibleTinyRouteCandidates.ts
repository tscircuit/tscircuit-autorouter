import type { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { createEmptyRegionIntersectionCache } from "tiny-hypergraph/lib/core"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"

type Segment = { region: number; route: number; from: number; to: number; net: number; lo: number; hi: number; mask: number; changes: number; length: number }
type Candidate = { segments: Segment[]; ports: Set<number>; key: string }
type Group = { net: number; candidates: [Candidate, Candidate] }
type Score = { max: number; total: number; density: number; length: number; changes: number; singleLayerCrossings: number }
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

function scoreSelection(groups: Group[], choices: number[], solver: TinyHyperGraphSolver): Score | null {
  const owners = new Map<number, number>()
  const regions = Array.from({ length: solver.topology.regionCount }, () => [] as Segment[])
  let length = 0
  let changes = 0
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!
    const candidate = group.candidates[choices[i] as 0 | 1]
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
    let same = 0
    let cross = 0
    let transitions = 0
    for (let i = 0; i < segments.length; i++) {
      const a = segments[i]!
      transitions += a.changes
      for (let j = 0; j < i; j++) {
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

/** Two-net exchanges can resolve ownership conflicts that no legal one-net switch can cross. */
export function allocateCompatibleTinyRouteCandidates(baseline: TinyHyperGraphSolver, alternative: TinyHyperGraphSolver, provenance: { hasPreloadedCopper: boolean }): JointCandidateAllocationStats {
  const stats: JointCandidateAllocationStats = { jointCandidateAvailableBoards: 1, jointCandidateEligibleBoards: 0, jointCandidateTopologyMismatch: 0, jointCandidatePreloadedUnavailable: 0, jointCandidateNetGroups: 0, jointCandidateDistinctNetGroups: 0, jointCandidateTrials: 0, jointCandidateAcceptedExchanges: 0, jointCandidateSimultaneousExchanges: 0, jointCandidateHybridNetCount: 0, jointCandidateMixedBoards: 0, jointCandidateInitialDensity: 0, jointCandidateFinalDensity: 0 }
  // Section optimization reconstructs ordinary solved routes as initial
  // assignments. Only original physical copper provenance makes mixing unsafe.
  if (provenance.hasPreloadedCopper || baseline.problem.routeMetadata?.some((r) => r?.preloadedTraceSection) || alternative.problem.routeMetadata?.some((r) => r?.preloadedTraceSection)) { stats.jointCandidatePreloadedUnavailable++; return stats }
  if (!haveIdenticalCandidateTopology(baseline, alternative)) { stats.jointCandidateTopologyMismatch++; return stats }
  const first = getCandidatesByNet(baseline)
  const second = getCandidatesByNet(alternative)
  const groups: Group[] = [...first].map(([net, candidate]) => {
    const other = second.get(net)
    if (!other) throw new Error("Joint candidate allocation lost an electrical net")
    return { net, candidates: [candidate, other] }
  })
  stats.jointCandidateEligibleBoards = 1
  stats.jointCandidateNetGroups = groups.length
  stats.jointCandidateDistinctNetGroups = groups.filter((g) => g.candidates[0].key !== g.candidates[1].key).length
  let choices = groups.map(() => 0)
  const original = scoreSelection(groups, choices, baseline)
  if (!original) throw new Error("Joint allocation baseline violates shared-port ownership")
  const nativePressure = getNativePressure(baseline)
  const maximumPressure = Math.min(original.max, nativePressure.max)
  const totalPressure = Math.min(original.total, nativePressure.total)
  let current = original
  stats.jointCandidateInitialDensity = original.density
  for (let sweep = 0; sweep < 2; sweep++) {
    let improved = false
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!
      if (group.candidates[0].key === group.candidates[1].key) continue
      const proposed = [...choices]
      proposed[i] = 1 - proposed[i]!
      const desired = group.candidates[proposed[i] as 0 | 1]
      const blockers = groups.flatMap((other, j) => j !== i && [...desired.ports].some((p) => other.candidates[choices[j] as 0 | 1].ports.has(p)) ? [j] : [])
      if (blockers.length > 1) continue
      if (blockers.length === 1) proposed[blockers[0]!] = 1 - proposed[blockers[0]!]!
      stats.jointCandidateTrials++
      const score = scoreSelection(groups, proposed, baseline)
      if (!score || score.length > original.length + 1e-7 || score.changes > original.changes || score.singleLayerCrossings > 0 || score.max > maximumPressure + 1e-9 || score.total > totalPressure + 1e-9 || score.density > original.density) continue
      const better = score.max < current.max - 1e-9 || Math.abs(score.max - current.max) <= 1e-9 && (score.total < current.total - 1e-9 || Math.abs(score.total - current.total) <= 1e-9 && score.density < current.density)
      if (!better) continue
      choices = proposed
      current = score
      improved = true
      stats.jointCandidateAcceptedExchanges++
      if (blockers.length === 1) stats.jointCandidateSimultaneousExchanges++
    }
    if (!improved) break
  }
  stats.jointCandidateHybridNetCount = choices.filter((c) => c === 1).length
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
    const candidate = group.candidates[choices[i] as 0 | 1]
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
}
