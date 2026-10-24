/*
 * expandException adapts the native leaf from tiny-hypergraph core.ts,
 * https://github.com/tscircuit/tiny-hypergraph/tree/e5e1d34f6df3f9b364dc420b17ec5c97cd487fa0
 * MIT License — Copyright (c) 2026 tscircuit
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { TinyHyperGraphSolver, type Candidate, type TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"

type Frontier = { neighbors: number[]; next: Int32Array; head: number }
type Host = Omit<TinyHyperGraphSolver, never> & {
  ADD_SEGMENT_DISTANCE_TO_G: boolean
  candidateFirstRegionByPortId: Int32Array
  candidateSecondRegionByPortId: Int32Array
  expandRegionalHopFrontier(candidate: Candidate, frontier: Frontier): void
  computeRegionCostForRegion(region: number, same: number, cross: number, changes: number, count: number): number
  createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver
}
type Region = {
  neighbors: number[]
  cache: object
  endpoints: number[]
  classes: Map<number, Candidate[]>
  magnitude: number
  coordinateBound: number
  eligible: boolean
  hasGoal: boolean
}
type Context = {
  state: unknown; queue: unknown; epoch: unknown; route: number | undefined
  net: number | undefined; goal: number; generation: number
  best: unknown; stamps: unknown; topology: unknown; problem: unknown
  x: unknown; y: unknown; z: unknown; angle1: unknown; angle2: unknown
  incidents: unknown; penalty: unknown; regions: Map<number, Region>
  scale: number; viaSize: number; density: number
  retained: number
}
export type GeometricRegionalDiagnostics = {
  coneInstalledSolvers: number; coneCustomSolvers: number
  coneExpansions: number; coneNativeExpansions: number
  coneDominatedExpansions: number; coneSourceComparisons: number
  coneRegionBuilds: number; coneRegionPortReads: number; coneForeignEndpointReads: number
  coneExceptionLeaves: number; coneExceptionComputeG: number; coneExceptionQueues: number
  coneContexts: number; coneMaxRetainedSources: number; coneMaxClassSources: number
  coneGoalExcluded: number; coneNumericExcluded: number
}

export function createGeometricRegionalDiagnostics(): GeometricRegionalDiagnostics {
  return {
    coneInstalledSolvers: 0, coneCustomSolvers: 0,
    coneExpansions: 0, coneNativeExpansions: 0,
    coneDominatedExpansions: 0, coneSourceComparisons: 0,
    coneRegionBuilds: 0, coneRegionPortReads: 0, coneForeignEndpointReads: 0,
    coneExceptionLeaves: 0, coneExceptionComputeG: 0, coneExceptionQueues: 0,
    coneContexts: 0, coneMaxRetainedSources: 0, coneMaxClassSources: 0,
    coneGoalExcluded: 0, coneNumericExcluded: 0,
  }
}

const native = TinyHyperGraphSolver.prototype as unknown as Host
const expand = native.expandRegionalHopFrontier
const MIN_DENSE_PORTS = 16
const installed = new WeakSet<object>()

/**
 * For sources in the same strict angular cell and exact layer, every destination
 * has the same native crossing/entry-exit cost. Triangle inequality therefore
 * makes g(u)+k|u-v|<g(v) a whole outgoing-family dominance certificate.
 *
 * Binary64 native costs have at most four ordered additions after their common
 * region delta, and distance has two subtractions/products, add, sqrt, multiply.
 * All native intermediate magnitudes are below 32*m in the declared domain.
 * 1024*epsilon*m exceeds their combined normal rounding error, including the
 * computed source distance and certificate additions. Squared distances can
 * underflow before sqrt; 64*sqrt(MIN_VALUE)*scale separately bounds that error,
 * even when a huge scale amplifies it. Reject overflow domains
 * and equality; no native near-tie is certified using real arithmetic alone.
 *
 * This operator uses OWNED_REGIONAL_HOP_FRONTIER's native-owned search domain:
 * region cache contents, congestion, penalties, masks, reservations and owners
 * remain fixed during a route's queue epoch; native best costs only decrease.
 * Native completion replaces caches and clears the queue. In-place external
 * scene/cost edits or candidate injection require a new epoch, as do ordinary
 * retained native regional frontiers. Candidate objects are not recycled by
 * IndexedCandidateHeap (only the derived hopId may be annotated).
 */
export function geometricSourceDominates(
  sourceG: number, candidateG: number, dx: number, dy: number,
  scale: number, commonMagnitude: number,
): boolean {
  if (!(sourceG < candidateG)) return false
  const magnitude = Math.max(1, Math.abs(sourceG), Math.abs(candidateG), commonMagnitude)
  if (!Number.isFinite(magnitude) || magnitude > Number.MAX_VALUE / 64 ||
    !Number.isFinite(scale) || scale < 0) return false
  const distanceCost = Math.sqrt(dx * dx + dy * dy) * scale
  const slack = 1024 * Number.EPSILON * magnitude + 64 * Math.sqrt(Number.MIN_VALUE) * scale
  return Number.isFinite(distanceCost) && sourceG + distanceCost + slack < candidateG
}

function buildRegion(host: Host, regionId: number, neighbors: number[], work?: GeometricRegionalDiagnostics): Region {
  const { state, topology, problem } = host
  const cache = state.regionIntersectionCaches[regionId]!
  const endpoints: number[] = []
  let foreign = 0, coordinate = 0, penalty = 0
  let eligible = Number.isFinite(host.minViaPadDiameter) && host.minViaPadDiameter >= 0 &&
    Number.isFinite(host.TRACE_DENSITY_COST_FACTOR) && host.TRACE_DENSITY_COST_FACTOR >= 0 &&
    topology.regionWidth[regionId]! > 0 && topology.regionHeight[regionId]! > 0
  for (let i = 0; i < cache.netIds.length; i++) {
    if (work) work.coneForeignEndpointReads++
    if (cache.netIds[i] === state.currentRouteNetId) continue
    eligible &&= Number.isFinite(cache.lesserAngles[i]) && Number.isFinite(cache.greaterAngles[i])
    endpoints.push(cache.lesserAngles[i]!, cache.greaterAngles[i]!)
    foreign++
  }
  for (const port of neighbors) {
    if (work) work.coneRegionPortReads++
    coordinate = Math.max(coordinate, Math.abs(topology.portX[port]!), Math.abs(topology.portY[port]!))
    penalty = Math.max(penalty, Math.abs(problem.portPenalty?.[port] ?? 0))
    eligible &&= Number.isInteger(topology.portZ[port]) && topology.portZ[port]! >= 0 && topology.portZ[port]! < 32
  }
  const maximumRegionCost = host.computeRegionCostForRegion(
    regionId, cache.existingSameLayerIntersections + foreign,
    cache.existingCrossingLayerIntersections + foreign,
    cache.existingEntryExitLayerChanges + 1, cache.existingSegmentCount + 1,
  )
  const magnitude = Math.max(1, coordinate * 4 * host.DISTANCE_TO_COST,
    penalty, Math.abs(state.regionCongestionCost[regionId]!),
    Math.abs(maximumRegionCost) + Math.abs(cache.existingRegionCost))
  // Even a tiny scale cannot repair an overflowing native dx*dx before sqrt.
  // Exclude that domain rather than apply a real-valued triangle bound to Inf.
  eligible &&= Number.isFinite(coordinate) && coordinate <= Math.sqrt(Number.MAX_VALUE) / 8 &&
    Number.isFinite(magnitude) && magnitude <= Number.MAX_VALUE / 64
  if (work) work.coneRegionBuilds++
  return { neighbors, cache, endpoints: [...new Set(endpoints)].sort((a, b) => a - b), classes: new Map(), magnitude, coordinateBound: coordinate, eligible, hasGoal: neighbors.includes(state.goalPortId) }
}

function expandException(host: Host, candidate: Candidate, port: number, work?: GeometricRegionalDiagnostics): void {
  if (work) work.coneExceptionLeaves++
  const { state, topology, problem } = host
  if (port === candidate.portId || problem.portSectionMask[port] === 0) return
  const incidents = topology.incidentPortRegion[port]!
  const nextRegionId = incidents[0] === candidate.nextRegionId ? incidents[1] : incidents[0]
  if (nextRegionId === undefined) return
  const hopId = host.getHopId(port, nextRegionId)
  const closed = state.candidateQueue.isClosedHopId
    ? state.candidateQueue.isClosedHopId(hopId)
    : state.candidateQueue.isClosedHop?.(port, nextRegionId)
  if (closed === true || host.isPortReservedForDifferentNet(port)) return
  const owner = state.portAssignment[port]
  if (owner !== -1 && owner !== state.currentRouteNetId) return
  if (host.isRegionReservedForDifferentNet(nextRegionId)) return
  const previous = host.getCandidateBestCost(hopId)
  if (candidate.g >= previous) return
  const dx = topology.portX[candidate.portId]! - topology.portX[port]!
  const dy = topology.portY[candidate.portId]! - topology.portY[port]!
  const distance = Math.sqrt(dx * dx + dy * dy)
  const lower = candidate.g + state.regionCongestionCost[candidate.nextRegionId]! +
    (problem.portPenalty?.[port] ?? 0) + distance * host.DISTANCE_TO_COST
  if (lower >= previous) return
  if (work) work.coneExceptionComputeG++
  const g = host.computeG(candidate, port, previous, distance)
  if (!Number.isFinite(g) || g >= previous) return
  const h = host.computeH(port)
  host.setCandidateBestCost(hopId, g)
  state.candidateQueue.queue({ hopId, prevRegionId: candidate.nextRegionId,
    nextRegionId, portId: port, g, h, f: g + h, prevCandidate: candidate })
  if (work) work.coneExceptionQueues++
}

export function installGeometricRegionalDominance(
  solver: TinyHyperGraphSolver, diagnostics: GeometricRegionalDiagnostics, collectWork = false,
): void {
  if (installed.has(solver)) return
  installed.add(solver)
  const host = solver as unknown as Host
  if (host.expandRegionalHopFrontier !== expand || host.computeG !== native.computeG ||
    host.getCandidateBestCost !== native.getCandidateBestCost || host.setCandidateBestCost !== native.setCandidateBestCost ||
    host.getHopId !== native.getHopId || host.computeRegionCostForRegion !== native.computeRegionCostForRegion ||
    host.isPortReservedForDifferentNet !== native.isPortReservedForDifferentNet ||
    host.isRegionReservedForDifferentNet !== native.isRegionReservedForDifferentNet) {
    diagnostics.coneCustomSolvers++
    return
  }
  diagnostics.coneInstalledSolvers++
  const work = collectWork ? diagnostics : undefined
  let context: Context | undefined
  const factory = host.createGreedyFinalRouteSolver
  host.createGreedyFinalRouteSolver = function(options, attempt): TinyHyperGraphSolver {
    const child = factory.call(this, options, attempt)
    installGeometricRegionalDominance(child, diagnostics, collectWork)
    return child
  }
  host.expandRegionalHopFrontier = function(candidate, frontier): void {
    if (work) work.coneExpansions++
    const { state, topology, problem } = this
    const epoch = (state.candidateQueue as { closureEpoch?: unknown }).closureEpoch
    if (!this.OWNED_REGIONAL_HOP_FRONTIER || !this.ADD_SEGMENT_DISTANCE_TO_G ||
      frontier.neighbors.length < MIN_DENSE_PORTS || !Number.isFinite(this.DISTANCE_TO_COST) || this.DISTANCE_TO_COST < 0) {
      if (work) work.coneNativeExpansions++
      expand.call(this, candidate, frontier)
      return
    }
    if (!context || context.state !== state || context.queue !== state.candidateQueue || context.epoch !== epoch ||
      context.route !== state.currentRouteId || context.net !== state.currentRouteNetId || context.goal !== state.goalPortId ||
      context.generation !== state.candidateBestCostGeneration || context.best !== state.candidateBestCostByHopId ||
      context.stamps !== state.candidateBestCostGenerationByHopId || context.topology !== topology || context.problem !== problem ||
      context.x !== topology.portX || context.y !== topology.portY || context.z !== topology.portZ ||
      context.angle1 !== topology.portAngleForRegion1 || context.angle2 !== topology.portAngleForRegion2 ||
      context.incidents !== topology.incidentPortRegion || context.penalty !== problem.portPenalty ||
      context.scale !== this.DISTANCE_TO_COST || context.viaSize !== this.minViaPadDiameter || context.density !== this.TRACE_DENSITY_COST_FACTOR) {
      context = { state, queue: state.candidateQueue, epoch, route: state.currentRouteId,
        net: state.currentRouteNetId, goal: state.goalPortId, generation: state.candidateBestCostGeneration,
        best: state.candidateBestCostByHopId, stamps: state.candidateBestCostGenerationByHopId,
        topology, problem, x: topology.portX, y: topology.portY, z: topology.portZ,
        angle1: topology.portAngleForRegion1, angle2: topology.portAngleForRegion2,
        incidents: topology.incidentPortRegion, penalty: problem.portPenalty, regions: new Map(), retained: 0,
        scale: this.DISTANCE_TO_COST, viaSize: this.minViaPadDiameter, density: this.TRACE_DENSITY_COST_FACTOR }
      if (work) work.coneContexts++
    }
    let region = context.regions.get(candidate.nextRegionId)
    if (!region || region.neighbors !== frontier.neighbors || region.cache !== state.regionIntersectionCaches[candidate.nextRegionId]) {
      if (region) for (const sources of region.classes.values()) context.retained -= sources.length
      region = buildRegion(this, candidate.nextRegionId, frontier.neighbors, work)
      context.regions.set(candidate.nextRegionId, region)
    }
    // Native goal acceptance precedes all ordinary leaf tests and can return
    // without accepting its distance-aware final segment. Leave it untouched.
    if (region.hasGoal) {
      if (work) { work.coneGoalExcluded++; work.coneNativeExpansions++ }
      expand.call(this, candidate, frontier)
      return
    }
    if (!region.eligible || !Number.isFinite(candidate.g) ||
      !Number.isFinite(topology.portX[candidate.portId]) || !Number.isFinite(topology.portY[candidate.portId]) ||
      Math.abs(topology.portX[candidate.portId]!) > region.coordinateBound ||
      Math.abs(topology.portY[candidate.portId]!) > region.coordinateBound ||
      !Number.isInteger(topology.portZ[candidate.portId]) || topology.portZ[candidate.portId]! < 0 || topology.portZ[candidate.portId]! >= 32) {
      if (work) { work.coneNumericExcluded++; work.coneNativeExpansions++ }
      expand.call(this, candidate, frontier)
      return
    }
    const port = candidate.portId, r = candidate.nextRegionId
    const a = this.candidateFirstRegionByPortId[port] === r || this.candidateSecondRegionByPortId[port] !== r
      ? topology.portAngleForRegion1[port]! : (topology.portAngleForRegion2?.[port] ?? topology.portAngleForRegion1[port]!)
    if (!Number.isFinite(a)) {
      if (work) { work.coneNumericExcluded++; work.coneNativeExpansions++ }
      expand.call(this, candidate, frontier)
      return
    }
    let low = 0, high = region.endpoints.length
    while (low < high) { const middle = (low + high) >>> 1; if (region.endpoints[middle]! < a) low = middle + 1; else high = middle }
    const key = (low * 2 + (region.endpoints[low] === a ? 1 : 0)) * 32 + topology.portZ[port]!
    let sources = region.classes.get(key)
    if (!sources) { sources = []; region.classes.set(key, sources) }
    for (const source of sources) {
      if (work) work.coneSourceComparisons++
      if (!(source.g < candidate.g)) continue
      if (geometricSourceDominates(source.g, candidate.g,
        topology.portX[source.portId]! - topology.portX[port]!,
        topology.portY[source.portId]! - topology.portY[port]!,
        this.DISTANCE_TO_COST, region.magnitude)) {
        if (work) work.coneDominatedExpansions++
        // The earlier source skipped itself; this is the only destination
        // whose transition it did not already evaluate for the whole family.
        expandException(this, candidate, source.portId, work)
        return
      }
    }
    if (work) work.coneNativeExpansions++
    expand.call(this, candidate, frontier)
    sources.push(candidate)
    context.retained++
    if (work) {
      work.coneMaxRetainedSources = Math.max(work.coneMaxRetainedSources, context.retained)
      work.coneMaxClassSources = Math.max(work.coneMaxClassSources, sources.length)
    }
  }
}
