/*
 * materializeLeaf adapts tiny-hypergraph core.ts at
 * https://github.com/tscircuit/tiny-hypergraph/tree/e5e1d34f6df3f9b364dc420b17ec5c97cd487fa0
 * MIT License, Copyright (c) 2026 tscircuit
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import {
  TinyHyperGraphSolver,
  type Candidate,
  type TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/core"
import { setNewIntersectionCounts, type MutableIntersectionCount } from "tiny-hypergraph/lib/countNewIntersections"
import { IndexedCandidateHeap } from "tiny-hypergraph/lib/indexed-candidate-heap"
import { OutsideInPartialRipTinyHyperGraphSolver } from "tiny-hypergraph/lib/outside-in-partial-rip-tiny-hypergraph-solver"

type Frontier = { neighbors: number[]; next: Int32Array; head: number }
type Host = Omit<TinyHyperGraphSolver, never> & {
  ADD_SEGMENT_DISTANCE_TO_G: boolean
  candidateFirstRegionByPortId: Int32Array
  candidateSecondRegionByPortId: Int32Array
  expandRegionalHopFrontier(candidate: Candidate, frontier: Frontier): void
  populateBaseSegmentGeometryScratch(region: number, from: number, to: number): MutableIntersectionCount
  computeRegionCostForRegion(region: number, same: number, cross: number, changes: number, count: number): number
  createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver
}
type Exit = { port: number; next: number; hop: number; x: number; y: number; penalty: number; h: number }
export type RegionalBoundNode = {
  minX: number; maxX: number; minY: number; maxY: number
  minPenalty: number; minH: number
}
type Tree = RegionalBoundNode & { openCount: number; parent?: Tree; exits?: Exit[]; left?: Tree; right?: Tree }
type ClosureRegistry = { leavesByHop: Map<number, Set<Tree>>; memberships: number }
type ExitClass = { representative: number; tree: Tree; count: number }
type RegionIndex = {
  neighbors: number[]; cache: object; classes: ExitClass[]; eligible: boolean
  endpoints: number[]; sourceClassDeltas: Map<number, Map<number, number>>
}
type DeferredFamily = { candidate: Candidate; tree: Tree; delta: number; bound: number; order: number }

export type ImplicitRegionalDiagnostics = {
  implicitInstalledSolvers: number; implicitUnsupportedSolvers: number
  implicitExpansions: number; implicitNativeExpansions: number
  implicitRegionBuilds: number; implicitPortReads: number; implicitForeignEndpointReads: number
  implicitTreeNodes: number; implicitSortComparisons: number; implicitHeuristicReads: number
  implicitCommonCostQueries: number; implicitImpossibleFamilies: number
  implicitFamilies: number; implicitBoundQueries: number; implicitSplits: number
  implicitHeapPushes: number; implicitHeapPops: number
  implicitLeafVisits: number; implicitClosedLeaves: number; implicitBestReads: number
  implicitComputeG: number; implicitCandidateQueues: number; implicitCandidatePops: number
  implicitClears: number; implicitDiscardedTasks: number; implicitMaxTasks: number
  implicitGoalNativeExpansions: number; implicitNumericNativeExpansions: number
  implicitClosureLookups: number; implicitClosureLeafVisits: number; implicitClosureAncestorWrites: number
  implicitClosedTreeSkips: number; implicitClosedBuildFiltered: number
  implicitReverseMemberships: number; implicitMaxReverseMemberships: number
  implicitCachedClassCosts: number
}

export function createImplicitRegionalDiagnostics(): ImplicitRegionalDiagnostics {
  return {
    implicitInstalledSolvers: 0, implicitUnsupportedSolvers: 0,
    implicitExpansions: 0, implicitNativeExpansions: 0,
    implicitRegionBuilds: 0, implicitPortReads: 0, implicitForeignEndpointReads: 0,
    implicitTreeNodes: 0, implicitSortComparisons: 0, implicitHeuristicReads: 0,
    implicitCommonCostQueries: 0, implicitImpossibleFamilies: 0,
    implicitFamilies: 0, implicitBoundQueries: 0, implicitSplits: 0,
    implicitHeapPushes: 0, implicitHeapPops: 0,
    implicitLeafVisits: 0, implicitClosedLeaves: 0, implicitBestReads: 0,
    implicitComputeG: 0, implicitCandidateQueues: 0, implicitCandidatePops: 0,
    implicitClears: 0, implicitDiscardedTasks: 0, implicitMaxTasks: 0,
    implicitGoalNativeExpansions: 0, implicitNumericNativeExpansions: 0,
    implicitClosureLookups: 0, implicitClosureLeafVisits: 0, implicitClosureAncestorWrites: 0,
    implicitClosedTreeSkips: 0, implicitClosedBuildFiltered: 0,
    implicitReverseMemberships: 0, implicitMaxReverseMemberships: 0,
    implicitCachedClassCosts: 0,
  }
}

const native = TinyHyperGraphSolver.prototype as unknown as Host
const nativeExpand = native.expandRegionalHopFrontier
const installed = new WeakSet<object>()
const MIN_REGION_PORTS = 16
const LEAF_EXITS = 4

/**
 * Componentwise monotonic bound, evaluated in EXACTLY native g/f addition order.
 * Each bbox coordinate difference has magnitude <= the corresponding native
 * source-to-exit difference; square/add/sqrt and nonnegative multiplication are
 * monotone even for subnormals. minPenalty and minH are actual stored native
 * leaf values. No triangle inequality, reassociation or epsilon certificate is
 * used. The common regional delta is the same binary64 value at every leaf in
 * this strict angular/layer class. NaNs are excluded before creating a family.
 */
export function implicitRegionalLowerBound(
  sourceG: number, sourceX: number, sourceY: number, delta: number,
  congestion: number, scale: number, tree: RegionalBoundNode,
): number {
  const dx = sourceX < tree.minX ? sourceX - tree.minX : sourceX > tree.maxX ? sourceX - tree.maxX : 0
  const dy = sourceY < tree.minY ? sourceY - tree.minY : sourceY > tree.maxY ? sourceY - tree.maxY : 0
  const distance = Math.sqrt(dx * dx + dy * dy)
  return sourceG + delta + congestion + tree.minPenalty + distance * scale + tree.minH
}

function buildTree(exits: Exit[], registry: ClosureRegistry, work?: ImplicitRegionalDiagnostics): Tree {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let minPenalty = Infinity, minH = Infinity
  for (const exit of exits) {
    minX = Math.min(minX, exit.x); maxX = Math.max(maxX, exit.x)
    minY = Math.min(minY, exit.y); maxY = Math.max(maxY, exit.y)
    minPenalty = Math.min(minPenalty, exit.penalty); minH = Math.min(minH, exit.h)
  }
  if (work) work.implicitTreeNodes++
  const node: Tree = { minX, maxX, minY, maxY, minPenalty, minH, openCount: exits.length }
  if (exits.length <= LEAF_EXITS) {
    node.exits = exits
    for (const exit of exits) {
      let leaves = registry.leavesByHop.get(exit.hop)
      if (!leaves) { leaves = new Set(); registry.leavesByHop.set(exit.hop, leaves) }
      if (!leaves.has(node)) {
        leaves.add(node); registry.memberships++
        if (work) {
          work.implicitReverseMemberships++
          work.implicitMaxReverseMemberships = Math.max(work.implicitMaxReverseMemberships, registry.memberships)
        }
      }
    }
    return node
  }
  const xAxis = maxX - minX >= maxY - minY
  exits.sort((a, b): number => {
    if (work) work.implicitSortComparisons++
    return xAxis ? a.x - b.x : a.y - b.y
  })
  const middle = exits.length >>> 1
  node.left = buildTree(exits.slice(0, middle), registry, work)
  node.right = buildTree(exits.slice(middle), registry, work)
  node.left.parent = node; node.right.parent = node
  return node
}

function angleFor(host: Host, region: number, port: number): number {
  return host.candidateFirstRegionByPortId[port] === region || host.candidateSecondRegionByPortId[port] !== region
    ? host.topology.portAngleForRegion1[port]!
    : (host.topology.portAngleForRegion2?.[port] ?? host.topology.portAngleForRegion1[port]!)
}

function classFor(angle: number, z: number, endpoints: number[]): number {
  let low = 0, high = endpoints.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (endpoints[middle]! < angle) low = middle + 1
    else high = middle
  }
  return (low * 2 + (endpoints[low] === angle ? 1 : 0)) * 32 + z
}

function buildRegionIndex(host: Host, region: number, neighbors: number[], registry: ClosureRegistry, work?: ImplicitRegionalDiagnostics): RegionIndex {
  const { state, topology, problem } = host
  const cache = state.regionIntersectionCaches[region]!
  const endpoints: number[] = []
  let eligible = topology.regionWidth[region]! > 0 && topology.regionHeight[region]! > 0 &&
    Number.isFinite(topology.regionWidth[region]! * topology.regionHeight[region]!) &&
    Number.isFinite(host.minViaPadDiameter) && host.minViaPadDiameter >= 0 &&
    Number.isFinite(host.TRACE_DENSITY_COST_FACTOR) && host.TRACE_DENSITY_COST_FACTOR >= 0 &&
    Number.isFinite(cache.existingRegionCost)
  for (let i = 0; i < cache.netIds.length; i++) {
    if (work) work.implicitForeignEndpointReads++
    if (cache.netIds[i] === state.currentRouteNetId) continue
    const a = cache.lesserAngles[i]!, b = cache.greaterAngles[i]!
    eligible &&= Number.isFinite(a) && Number.isFinite(b)
    endpoints.push(a, b)
  }
  const ordered = [...new Set(endpoints)].sort((a, b): number => a - b)
  const groups = new Map<number, Exit[]>()
  for (const port of neighbors) {
    if (work) work.implicitPortReads++
    const x = topology.portX[port]!, y = topology.portY[port]!, z = topology.portZ[port]!
    const penalty = problem.portPenalty?.[port] ?? 0, angle = angleFor(host, region, port)
    eligible &&= Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(angle) &&
      Math.abs(x) <= Math.sqrt(Number.MAX_VALUE) / 8 && Math.abs(y) <= Math.sqrt(Number.MAX_VALUE) / 8 &&
      Number.isInteger(z) && z >= 0 && z < 32 && Number.isFinite(penalty) && penalty >= 0
    if (problem.portSectionMask[port] === 0 || host.isPortReservedForDifferentNet(port)) continue
    if (state.portAssignment[port] !== -1 && state.portAssignment[port] !== state.currentRouteNetId) continue
    const incident = topology.incidentPortRegion[port]!
    const next = incident[0] === region ? incident[1] : incident[0]
    if (next === undefined || host.isRegionReservedForDifferentNet(next)) continue
    const hop = host.getHopId(port, next)
    if (host.state.candidateQueue.isClosedHopId!(hop)) {
      if (work) work.implicitClosedBuildFiltered++
      continue
    }
    const h = host.computeH(port)
    if (work) work.implicitHeuristicReads++
    eligible &&= Number.isFinite(h) && h >= 0
    const key = classFor(angle, z, ordered)
    let group = groups.get(key)
    if (!group) { group = []; groups.set(key, group) }
    group.push({ port, next, hop, x, y, penalty, h })
  }
  const classes: ExitClass[] = []
  if (eligible) for (const exits of groups.values()) {
    classes.push({ representative: exits[0]!.port, count: exits.length, tree: buildTree(exits, registry, work) })
  }
  if (work) work.implicitRegionBuilds++
  return { neighbors, cache, classes, eligible, endpoints: ordered, sourceClassDeltas: new Map() }
}

function commonRegionDelta(host: Host, candidate: Candidate, representative: number, work?: ImplicitRegionalDiagnostics): number {
  if (work) work.implicitCommonCostQueries++
  const region = candidate.nextRegionId, cache = host.state.regionIntersectionCaches[region]!
  const geometry = host.populateBaseSegmentGeometryScratch(region, candidate.portId, representative)
  geometry.sameLayerIntersectionCount = 0; geometry.crossingLayerIntersectionCount = 0
  if (cache.existingSegmentCount > 0) setNewIntersectionCounts(cache, geometry)
  if (geometry.sameLayerIntersectionCount > 0 && host.isKnownSingleLayerRegion(region)) return Infinity
  return host.computeRegionCostForRegion(region,
    cache.existingSameLayerIntersections + geometry.sameLayerIntersectionCount,
    cache.existingCrossingLayerIntersections + geometry.crossingLayerIntersectionCount,
    cache.existingEntryExitLayerChanges + geometry.entryExitLayerChanges,
    cache.existingSegmentCount + 1) - cache.existingRegionCost
}

function materializeLeaf(host: Host, source: Candidate, exit: Exit, work?: ImplicitRegionalDiagnostics): void {
  if (work) work.implicitLeafVisits++
  const { state, topology } = host
  if (exit.port === source.portId) return
  if (state.candidateQueue.isClosedHopId!(exit.hop)) {
    if (work) work.implicitClosedLeaves++
    return
  }
  if (work) work.implicitBestReads++
  const previous = host.getCandidateBestCost(exit.hop)
  if (source.g >= previous) return
  const dx = topology.portX[source.portId]! - exit.x, dy = topology.portY[source.portId]! - exit.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const lower = source.g + state.regionCongestionCost[source.nextRegionId]! + exit.penalty + distance * host.DISTANCE_TO_COST
  if (lower >= previous) return
  if (work) work.implicitComputeG++
  const g = host.computeG(source, exit.port, previous, distance)
  if (!Number.isFinite(g) || g >= previous) return
  host.setCandidateBestCost(exit.hop, g)
  state.candidateQueue.queue({ hopId: exit.hop, prevRegionId: source.nextRegionId,
    nextRegionId: exit.next, portId: exit.port, g, h: exit.h, f: g + exit.h, prevCandidate: source })
  if (work) work.implicitCandidateQueues++
}

/**
 * A family is an unevaluated weighted source/tree pair, not a routed candidate.
 * It competes by a native-arithmetic lower bound. Before closing a concrete hop,
 * resolve every family that might beat its f. This changes equal-f insertion
 * order, and deferred best labels change the finite-budget policy. Native costs,
 * hard endpoint/resource tests, concrete hop closure and outer step cap remain.
 * Inspection exposes concrete candidates only; pending families are separately
 * represented by length and diagnostics rather than fake coordinate witnesses.
 * OWNED_REGIONAL_HOP_FRONTIER is required: coordinates/incidence/angle arrays,
 * cache contents, penalties, congestion, ownership, masks and native cost options
 * are immutable during a route queue epoch. Every native commit/rip clears it.
 */
class ImplicitRegionalQueue extends IndexedCandidateHeap {
  private tasks: DeferredFamily[] = []
  private nextOrder = 0
  private regions = new Map<number, RegionIndex>()
  private goalRegions = new Map<number, boolean>()
  private registry: ClosureRegistry = { leavesByHop: new Map(), memberships: 0 }
  private context?: { route: number | undefined; net: number | undefined; goal: number }
  constructor(private host: Host, private concrete: IndexedCandidateHeap, private work?: ImplicitRegionalDiagnostics) { super(0) }
  override get closureEpoch(): object { return this.concrete.closureEpoch }
  override get length(): number { return this.concrete.length + this.tasks.length }
  override toArray(): Candidate[] { return this.concrete.toArray() }
  override isClosedHop(port: number, next: number): boolean { return this.concrete.isClosedHop(port, next) }
  override isClosedHopId(hop: number): boolean { return this.concrete.isClosedHopId(hop) }
  override queue(candidate: Candidate): void { this.concrete.queue(candidate) }
  override clear(): void {
    if (this.work) { this.work.implicitClears++; this.work.implicitDiscardedTasks += this.tasks.length }
    this.tasks.length = 0; this.nextOrder = 0
    this.registry.leavesByHop.clear(); this.registry.memberships = 0
    this.regions.clear(); this.goalRegions.clear(); this.context = undefined; this.concrete.clear()
  }
  private push(candidate: Candidate, tree: Tree, delta: number): void {
    if (tree.openCount === 0) { if (this.work) this.work.implicitClosedTreeSkips++; return }
    const host = this.host
    const bound = implicitRegionalLowerBound(candidate.g, host.topology.portX[candidate.portId]!,
      host.topology.portY[candidate.portId]!, delta, host.state.regionCongestionCost[candidate.nextRegionId]!,
      host.DISTANCE_TO_COST, tree)
    if (this.work) { this.work.implicitBoundQueries++; this.work.implicitHeapPushes++ }
    if (Number.isNaN(bound)) throw new Error("Implicit regional family produced a NaN lower bound")
    const task = { candidate, tree, delta, bound, order: this.nextOrder++ }
    let i = this.tasks.length
    this.tasks.push(task)
    while (i > 0) {
      const parent = (i - 1) >>> 1
      if (!this.less(task, this.tasks[parent]!)) break
      this.tasks[i] = this.tasks[parent]!; i = parent
    }
    this.tasks[i] = task
    if (this.work) this.work.implicitMaxTasks = Math.max(this.work.implicitMaxTasks, this.tasks.length)
  }
  private less(a: DeferredFamily, b: DeferredFamily): boolean {
    return a.bound < b.bound || (a.bound === b.bound && a.order < b.order)
  }
  private pop(): DeferredFamily {
    const first = this.tasks[0]!, last = this.tasks.pop()!
    if (this.work) this.work.implicitHeapPops++
    if (this.tasks.length > 0) {
      let i = 0
      while (i * 2 + 1 < this.tasks.length) {
        const left = i * 2 + 1, right = left + 1
        const child = right < this.tasks.length && this.less(this.tasks[right]!, this.tasks[left]!) ? right : left
        if (!this.less(this.tasks[child]!, last)) break
        this.tasks[i] = this.tasks[child]!; i = child
      }
      this.tasks[i] = last
    }
    return first
  }
  override dequeue(): Candidate | undefined {
    if (this.context && (this.context.route !== this.host.state.currentRouteId ||
      this.context.net !== this.host.state.currentRouteNetId || this.context.goal !== this.host.state.goalPortId)) {
      throw new Error("Implicit regional route context changed while families were pending")
    }
    while (this.tasks.length > 0) {
      // Exact native queue class is guarded at installation. Reading its root
      // avoids copying the whole concrete heap for every lower-bound comparison.
      const best = (this.concrete as unknown as { items: Candidate[] }).items[0]
      if (this.tasks[0]!.tree.openCount === 0) {
        this.pop(); if (this.work) this.work.implicitClosedTreeSkips++; continue
      }
      if (best && this.tasks[0]!.bound > best.f) break
      const task = this.pop(), tree = task.tree
      if (this.regions.get(task.candidate.nextRegionId)?.cache !== this.host.state.regionIntersectionCaches[task.candidate.nextRegionId]) {
        throw new Error("Implicit regional scene changed while geometric families were pending")
      }
      if (tree.exits) {
        for (const exit of tree.exits) materializeLeaf(this.host, task.candidate, exit, this.work)
      } else {
        if (!tree.left || !tree.right) throw new Error("Implicit regional tree has no children")
        if (this.work) this.work.implicitSplits++
        this.push(task.candidate, tree.left, task.delta)
        this.push(task.candidate, tree.right, task.delta)
      }
    }
    const candidate = this.concrete.dequeue()
    if (candidate) {
      if (this.work) this.work.implicitClosureLookups++
      const hop = candidate.hopId ?? this.host.getHopId(candidate.portId, candidate.nextRegionId)
      const leaves = this.registry.leavesByHop.get(hop)
      if (leaves) {
        for (const leaf of leaves) {
          if (this.work) this.work.implicitClosureLeafVisits++
          let removed = 0
          for (const exit of leaf.exits!) if (exit.hop === hop) removed++
          for (let node: Tree | undefined = leaf; node; node = node.parent) {
            node.openCount -= removed
            if (this.work) this.work.implicitClosureAncestorWrites++
          }
        }
        this.registry.memberships -= leaves.size
        this.registry.leavesByHop.delete(hop)
      }
    }
    if (candidate && this.work) this.work.implicitCandidatePops++
    return candidate
  }
  defer(candidate: Candidate, frontier: Frontier): void {
    const host = this.host, region = candidate.nextRegionId, neighbors = frontier.neighbors
    const context = { route: host.state.currentRouteId, net: host.state.currentRouteNetId, goal: host.state.goalPortId }
    if (this.context && (context.route !== this.context.route || context.net !== this.context.net || context.goal !== this.context.goal)) {
      throw new Error("Implicit regional route context changed without clearing its queue")
    }
    this.context = context
    if (this.work) this.work.implicitExpansions++
    let hasGoal = this.goalRegions.get(region)
    if (hasGoal === undefined) { hasGoal = neighbors.includes(host.state.goalPortId); this.goalRegions.set(region, hasGoal) }
    if (hasGoal || neighbors.length < MIN_REGION_PORTS || !host.ADD_SEGMENT_DISTANCE_TO_G ||
      !Number.isFinite(host.DISTANCE_TO_COST) || host.DISTANCE_TO_COST < 0 || !Number.isFinite(candidate.g) ||
      !Number.isFinite(host.topology.portX[candidate.portId]) || !Number.isFinite(host.topology.portY[candidate.portId]) ||
      !Number.isInteger(host.topology.portZ[candidate.portId]) || host.topology.portZ[candidate.portId]! < 0 ||
      host.topology.portZ[candidate.portId]! >= 32 ||
      Math.abs(host.topology.portX[candidate.portId]!) > Math.sqrt(Number.MAX_VALUE) / 8 ||
      Math.abs(host.topology.portY[candidate.portId]!) > Math.sqrt(Number.MAX_VALUE) / 8 ||
      !Number.isFinite(angleFor(host, region, candidate.portId))) {
      if (this.work) { this.work.implicitNativeExpansions++; if (hasGoal) this.work.implicitGoalNativeExpansions++ }
      nativeExpand.call(host, candidate, frontier); return
    }
    let index = this.regions.get(region)
    if (!index) { index = buildRegionIndex(host, region, neighbors, this.registry, this.work); this.regions.set(region, index) }
    if (index.neighbors !== neighbors || index.cache !== host.state.regionIntersectionCaches[region]) {
      throw new Error("Implicit regional owned scene changed within a queue epoch")
    }
    if (!index.eligible) {
      if (this.work) { this.work.implicitNativeExpansions++; this.work.implicitNumericNativeExpansions++ }
      nativeExpand.call(host, candidate, frontier); return
    }
    const sourceKey = classFor(angleFor(host, region, candidate.portId), host.topology.portZ[candidate.portId]!, index.endpoints)
    let deltas = index.sourceClassDeltas.get(sourceKey)
    if (!deltas) { deltas = new Map(); index.sourceClassDeltas.set(sourceKey, deltas) }
    for (let classIndex = 0; classIndex < index.classes.length; classIndex++) {
      const group = index.classes[classIndex]!
      if (group.tree.openCount === 0) { if (this.work) this.work.implicitClosedTreeSkips++; continue }
      let delta = deltas.get(classIndex)
      if (delta === undefined) {
        delta = commonRegionDelta(host, candidate, group.representative, this.work)
        deltas.set(classIndex, delta)
      } else if (this.work) this.work.implicitCachedClassCosts++
      if (delta === Infinity) { if (this.work) this.work.implicitImpossibleFamilies++; continue }
      if (!Number.isFinite(delta)) throw new Error("Implicit regional class produced a nonfinite region delta")
      if (this.work) this.work.implicitFamilies++
      this.push(candidate, group.tree, delta)
    }
  }
}

export function installImplicitRegionalTransitions(
  solver: Omit<TinyHyperGraphSolver, never>, diagnostics: ImplicitRegionalDiagnostics, collectWork = false,
): void {
  if (installed.has(solver)) return
  installed.add(solver)
  const host = solver as unknown as Host
  if (host.expandRegionalHopFrontier !== nativeExpand || host.computeG !== native.computeG ||
    (host.computeH !== native.computeH && host.computeH !== OutsideInPartialRipTinyHyperGraphSolver.prototype.computeH) ||
    host.computeRegionCostForRegion !== native.computeRegionCostForRegion ||
    host.populateBaseSegmentGeometryScratch !== native.populateBaseSegmentGeometryScratch ||
    host.getCandidateBestCost !== native.getCandidateBestCost || host.setCandidateBestCost !== native.setCandidateBestCost ||
    host.getHopId !== native.getHopId || host.isPortReservedForDifferentNet !== native.isPortReservedForDifferentNet ||
    host.isRegionReservedForDifferentNet !== native.isRegionReservedForDifferentNet) {
    diagnostics.implicitUnsupportedSolvers++; return
  }
  diagnostics.implicitInstalledSolvers++
  const work = collectWork ? diagnostics : undefined
  const wrapQueue = (): void => {
    const queue = host.state.candidateQueue
    if (queue instanceof ImplicitRegionalQueue) return
    if (Object.getPrototypeOf(queue) !== IndexedCandidateHeap.prototype || !host.OWNED_REGIONAL_HOP_FRONTIER) return
    host.state.candidateQueue = new ImplicitRegionalQueue(host, queue as IndexedCandidateHeap, work)
  }
  const setup = host._setup
  host._setup = function(): void { setup.call(this); wrapQueue() }
  wrapQueue()
  host.expandRegionalHopFrontier = function(candidate, frontier): void {
    const queue = this.state.candidateQueue
    if (queue instanceof ImplicitRegionalQueue) queue.defer(candidate, frontier)
    else nativeExpand.call(this, candidate, frontier)
  }
  const factory = host.createGreedyFinalRouteSolver
  host.createGreedyFinalRouteSolver = function(options, attempt): TinyHyperGraphSolver {
    const child = factory.call(this, options, attempt)
    installImplicitRegionalTransitions(child, diagnostics, collectWork)
    return child
  }
}
