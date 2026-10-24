/* Regional delta arithmetic adapted from tiny-hypergraph core.ts at
 * e5e1d34f6df3f9b364dc420b17ec5c97cd487fa0.
 * MIT License, Copyright (c) 2026 tscircuit.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { TinyHyperGraphSolver, type Candidate, type TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"
import { setNewIntersectionCounts, type MutableIntersectionCount } from "tiny-hypergraph/lib/countNewIntersections"

type Host = Omit<TinyHyperGraphSolver, never> & {
  ADD_SEGMENT_DISTANCE_TO_G: boolean
  candidateFirstRegionByPortId: Int32Array
  candidateSecondRegionByPortId: Int32Array
  populateBaseSegmentGeometryScratch(region: number, from: number, to: number): MutableIntersectionCount
  computeRegionCostForRegion(region: number, same: number, cross: number, changes: number, count: number): number
  createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver
}
type RegionIndex = {
  cache: object; endpoints: number[]; stride: number; eligible: boolean
  classesByPort: Map<number, number>; deltas: Map<number, number>
}
export type RegionalClassCostDiagnostics = {
  installedSolvers: number; unsupportedSolvers: number; queries: number
  indexBuilds: number; foreignEndpointReads: number; endpointSortComparisons: number
  portClassQueries: number; portClassHits: number; binaryComparisons: number
  nativeQueries: number; classCostQueries: number; classCostHits: number
  classIntersectionRows: number; memoEntries: number; clears: number
}

export function createRegionalClassCostDiagnostics(): RegionalClassCostDiagnostics {
  return {
    installedSolvers: 0, unsupportedSolvers: 0, queries: 0, indexBuilds: 0,
    foreignEndpointReads: 0, endpointSortComparisons: 0, portClassQueries: 0,
    portClassHits: 0, binaryComparisons: 0, nativeQueries: 0,
    classCostQueries: 0, classCostHits: 0, classIntersectionRows: 0,
    memoEntries: 0, clears: 0,
  }
}

const native = TinyHyperGraphSolver.prototype as unknown as Host
const installed = new WeakSet<object>()

function buildIndex(host: Host, region: number, work?: RegionalClassCostDiagnostics): RegionIndex {
  const cache = host.state.regionIntersectionCaches[region]!
  const endpoints: number[] = []
  let eligible = Number.isFinite(cache.existingRegionCost)
  for (let index = 0; index < cache.netIds.length; index++) {
    if (work) work.foreignEndpointReads++
    if (cache.netIds[index] === host.state.currentRouteNetId) continue
    const a = cache.lesserAngles[index]!, b = cache.greaterAngles[index]!
    eligible &&= Number.isFinite(a) && Number.isFinite(b)
    endpoints.push(a, b)
  }
  const ordered = [...new Set(endpoints)].sort((a, b): number => {
    if (work) work.endpointSortComparisons++
    return a - b
  })
  const stride = (ordered.length * 2 + 1) * 32
  eligible &&= endpoints.length >= 8 && Number.isSafeInteger(stride * stride)
  if (work) work.indexBuilds++
  return { cache, endpoints: ordered, stride, eligible, classesByPort: new Map(), deltas: new Map() }
}

function portClass(host: Host, region: number, port: number, index: RegionIndex, work?: RegionalClassCostDiagnostics): number | undefined {
  if (work) work.portClassQueries++
  const known = index.classesByPort.get(port)
  if (known !== undefined) {
    if (work) work.portClassHits++
    return known
  }
  const angle = host.candidateFirstRegionByPortId[port] === region || host.candidateSecondRegionByPortId[port] !== region
    ? host.topology.portAngleForRegion1[port]!
    : (host.topology.portAngleForRegion2?.[port] ?? host.topology.portAngleForRegion1[port]!)
  const z = host.topology.portZ[port]!
  if (!Number.isFinite(angle) || !Number.isInteger(z) || z < 0 || z >= 32) return undefined
  let low = 0, high = index.endpoints.length
  while (low < high) {
    if (work) work.binaryComparisons++
    const middle = (low + high) >>> 1
    if (index.endpoints[middle]! < angle) low = middle + 1
    else high = middle
  }
  const key = (low * 2 + (index.endpoints[low] === angle ? 1 : 0)) * 32 + z
  index.classesByPort.set(port, key)
  return key
}

function regionDelta(host: Host, source: Candidate, destination: number, work?: RegionalClassCostDiagnostics): number {
  const region = source.nextRegionId, cache = host.state.regionIntersectionCaches[region]!
  const geometry = host.populateBaseSegmentGeometryScratch(region, source.portId, destination)
  geometry.sameLayerIntersectionCount = 0
  geometry.crossingLayerIntersectionCount = 0
  if (cache.existingSegmentCount > 0) {
    if (work) work.classIntersectionRows += cache.netIds.length
    setNewIntersectionCounts(cache, geometry)
  }
  if (geometry.sameLayerIntersectionCount > 0 && host.isKnownSingleLayerRegion(region)) return Infinity
  return host.computeRegionCostForRegion(region,
    cache.existingSameLayerIntersections + geometry.sameLayerIntersectionCount,
    cache.existingCrossingLayerIntersections + geometry.crossingLayerIntersectionCount,
    cache.existingEntryExitLayerChanges + geometry.entryExitLayerChanges,
    cache.existingSegmentCount + 1) - cache.existingRegionCost
}

/**
 * P1 ablation: preserve every native eager expansion/label/queue operation.
 * Only the regional delta is shared across strict angular endpoint classes
 * and layer pairs. Strict endpoint equalities have their own class; foreign
 * intervals see the same XOR crossing predicate and layer mask in each pair.
 * Delta is symmetric in the two endpoint classes. Preserve native binary64
 * addition order, early maximum-cost check, distances and all physical gates.
 * OWNED_REGIONAL_HOP_FRONTIER supplies an immutable scene during a queue epoch;
 * every native commit/rip clears the queue and invalidates these cost proofs.
 */
export function installRegionalClassCosts(
  solver: Omit<TinyHyperGraphSolver, never>, diagnostics: RegionalClassCostDiagnostics, collectWork = false,
): void {
  if (installed.has(solver)) return
  installed.add(solver)
  const host = solver as unknown as Host
  if (!host.OWNED_REGIONAL_HOP_FRONTIER || host.computeG !== native.computeG ||
    host.computeRegionCostForRegion !== native.computeRegionCostForRegion ||
    host.populateBaseSegmentGeometryScratch !== native.populateBaseSegmentGeometryScratch ||
    host.isKnownSingleLayerRegion !== native.isKnownSingleLayerRegion) {
    diagnostics.unsupportedSolvers++
    return
  }
  diagnostics.installedSolvers++
  const work = collectWork ? diagnostics : undefined
  const indices = new Map<number, RegionIndex>()
  let context: { route?: number; net?: number } | undefined
  let lastRegion: number | undefined, lastIndex: RegionIndex | undefined
  let lastSource: number | undefined, lastSourceClass: number | undefined
  const wrappedQueues = new WeakSet<object>()
  const wrapQueue = (): void => {
    const queue = host.state.candidateQueue
    if (wrappedQueues.has(queue)) return
    wrappedQueues.add(queue)
    const clear = queue.clear
    queue.clear = function(): void {
      indices.clear()
      context = undefined
      lastRegion = undefined
      lastIndex = undefined
      lastSource = undefined
      if (work) work.clears++
      clear.call(this)
    }
  }
  const setup = host._setup
  host._setup = function(): void {
    indices.clear()
    context = undefined
    lastRegion = undefined
    lastIndex = undefined
    lastSource = undefined
    setup.call(this)
    wrapQueue()
  }
  wrapQueue()
  host.computeG = function(source, destination, maximumCost = Infinity, knownSegmentDistance): number {
    if (work) work.queries++
    const region = source.nextRegionId
    // Four foreign segments are required by the static class-sharing domain.
    // Most queried regions contain fewer total segments; do not allocate an
    // index or touch the epoch registry for those native-only calls.
    if (this.state.regionIntersectionCaches[region]!.netIds.length < 4) {
      if (work) work.nativeQueries++
      return native.computeG.call(this, source, destination, maximumCost, knownSegmentDistance)
    }
    if (context && (context.route !== this.state.currentRouteId || context.net !== this.state.currentRouteNetId)) {
      throw new Error("Regional cost scene changed without clearing the native queue")
    }
    if (!context) context = { route: this.state.currentRouteId, net: this.state.currentRouteNetId }
    let index = lastRegion === region ? lastIndex : indices.get(region)
    if (!index) {
      index = buildIndex(this, region, work)
      indices.set(region, index)
    }
    if (lastRegion !== region) {
      lastSource = undefined
      lastRegion = region
      lastIndex = index
    }
    if (index.cache !== this.state.regionIntersectionCaches[region]) {
      throw new Error("Regional cost cache changed within an owned queue epoch")
    }
    if (lastSource !== source.portId) {
      lastSource = source.portId
      lastSourceClass = index.eligible ? portClass(this, region, source.portId, index, work) : undefined
    }
    const a = lastSourceClass
    const b = index.eligible ? portClass(this, region, destination, index, work) : undefined
    if (a === undefined || b === undefined) {
      if (work) work.nativeQueries++
      return native.computeG.call(this, source, destination, maximumCost, knownSegmentDistance)
    }
    let distanceCost = 0
    if (this.ADD_SEGMENT_DISTANCE_TO_G) {
      let distance = knownSegmentDistance
      if (distance === undefined) {
        const dx = this.topology.portX[source.portId]! - this.topology.portX[destination]!
        const dy = this.topology.portY[source.portId]! - this.topology.portY[destination]!
        distance = Math.sqrt(dx * dx + dy * dy)
      }
      distanceCost = distance * this.DISTANCE_TO_COST
    }
    const congestion = this.state.regionCongestionCost[region]!
    const penalty = this.problem.portPenalty?.[destination] ?? 0
    if (source.g + congestion + penalty + distanceCost > maximumCost + 1e-9) return Infinity
    const key = Math.min(a, b) * index.stride + Math.max(a, b)
    let delta = index.deltas.get(key)
    if (delta === undefined) {
      delta = regionDelta(this, source, destination, work)
      index.deltas.set(key, delta)
      if (work) { work.classCostQueries++; work.memoEntries++ }
    } else if (work) work.classCostHits++
    return source.g + delta + congestion + penalty + distanceCost
  }
  const factory = host.createGreedyFinalRouteSolver
  host.createGreedyFinalRouteSolver = function(options, attempt): TinyHyperGraphSolver {
    const child = factory.call(this, options, attempt)
    installRegionalClassCosts(child, diagnostics, collectWork)
    return child
  }
}
