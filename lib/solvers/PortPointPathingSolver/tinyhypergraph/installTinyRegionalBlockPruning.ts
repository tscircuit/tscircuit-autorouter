import { TinyHyperGraphSolver, type Candidate, type TinyHyperGraphSolverOptions } from "tiny-hypergraph/lib/core"

type Frontier = { neighbors: number[]; next: Int32Array; head: number }
type Host = Omit<TinyHyperGraphSolver, never> & {
  ADD_SEGMENT_DISTANCE_TO_G: boolean
  expandRegionalHopFrontier(candidate: Candidate, frontier: Frontier): void
  createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver
}
type Block = {
  start: number; end: number; first: number; last: number; live: number
  raw?: Float64Array; hopIds: number[]; built: boolean; dirty: boolean
  minX: number; maxX: number; minY: number; maxY: number; minPenalty: number
  maxBest: number; maxKnown: boolean; validGeometry: boolean; hasGoal: boolean
}
type BlockIndex = { blocks: Block[]; next: Int32Array; neighbors: number[] }
type Context = {
  state: unknown; generation: number; best: unknown; stamps: unknown
  goal: number; route: number | undefined; net: number | undefined; queue: unknown; queueEpoch: unknown
  topology: unknown; problem: unknown; x: unknown; y: unknown; penalty: unknown; incidents: unknown; regions: unknown
}

export type TinyRegionalBlockDiagnostics = {
  regionalBlockInstalledSolvers: number; regionalBlockCustomSolvers: number
  regionalBlockTypedPayloadBytes: number; regionalBlockIndexes: number
  regionalBlockWorkEnabled: number; regionalBlockExpansions: number
  regionalBlockQueries: number; regionalBlockPrunes: number
  regionalBlockPrunedOccurrences: number; regionalBlockLeafVisits: number
  regionalBlockMetadataReads: number; regionalBlockBestRefreshReads: number
  regionalBlockContextResets: number; regionalBlockHopMappings: number; regionalBlockDirtyWrites: number; regionalBlockContentValidationEnabled: number
  regionalBlockNativeObservedExpansions: number; regionalBlockNativeObservedOccurrences: number
  regionalBlockReverseVisits: number; regionalBlockCleanupVisits: number
  regionalBlockHopBuildVisits: number; regionalBlockSetterBestReads: number
  regionalBlockMaximumReverseHops: number; regionalBlockRegistryEntriesDiscarded: number
  regionalBlockMaximumActiveBlocks: number; regionalBlockMaximumActiveMemberships: number
}

export function createTinyRegionalBlockDiagnostics(): TinyRegionalBlockDiagnostics {
  return {
    regionalBlockInstalledSolvers: 0, regionalBlockCustomSolvers: 0,
    regionalBlockTypedPayloadBytes: 0, regionalBlockIndexes: 0,
    regionalBlockWorkEnabled: 0, regionalBlockExpansions: 0,
    regionalBlockQueries: 0, regionalBlockPrunes: 0,
    regionalBlockPrunedOccurrences: 0, regionalBlockLeafVisits: 0,
    regionalBlockMetadataReads: 0, regionalBlockBestRefreshReads: 0,
    regionalBlockContextResets: 0, regionalBlockHopMappings: 0,
    regionalBlockDirtyWrites: 0, regionalBlockContentValidationEnabled: 0,
    regionalBlockNativeObservedExpansions: 0, regionalBlockNativeObservedOccurrences: 0,
    regionalBlockReverseVisits: 0, regionalBlockCleanupVisits: 0,
    regionalBlockHopBuildVisits: 0, regionalBlockSetterBestReads: 0,
    regionalBlockMaximumReverseHops: 0, regionalBlockRegistryEntriesDiscarded: 0,
    regionalBlockMaximumActiveBlocks: 0, regionalBlockMaximumActiveMemberships: 0,
  }
}

const BLOCK_SIZE = 16
const MIN_PORTS = 32
const installed = new WeakSet<object>()
const prototype = TinyHyperGraphSolver.prototype as unknown as Host
const nativeExpand = prototype.expandRegionalHopFrontier
const nativeCost = prototype.computeG
const nativeGetBest = prototype.getCandidateBestCost
const nativeSetBest = prototype.setCandidateBestCost
const nativeHop = prototype.getHopId
const nativeReset = prototype.resetCandidateBestCosts

/** Bounds use the native expression order. No real-arithmetic epsilon is used. */
export function regionalBlockLowerBound(
  x: number, y: number, g: number, congestion: number, scale: number,
  block: Pick<Block, "minX" | "maxX" | "minY" | "maxY" | "minPenalty">,
): number {
  const dx = x < block.minX ? block.minX - x : x > block.maxX ? x - block.maxX : 0
  const dy = y < block.minY ? block.minY - y : y > block.maxY ? y - block.maxY : 0
  const distance = Math.sqrt(dx * dx + dy * dy)
  const withoutDistance = g + congestion + block.minPenalty
  return withoutDistance + distance * scale
}

function refreshGeometry(host: Host, frontier: Frontier, block: Block, validateContents: boolean): boolean {
  const { topology, problem, state } = host
  if (block.built && !validateContents) return false
  let changed = !block.built
  for (let i = block.start; !changed && i < block.end; i++) {
    const port = frontier.neighbors[i]!
    const incident = topology.incidentPortRegion[port]
    const offset = (i - block.start) * 6
    changed = !Object.is(block.raw![offset], port) ||
      !Object.is(block.raw![offset + 1], topology.portX[port]) ||
      !Object.is(block.raw![offset + 2], topology.portY[port]) ||
      !Object.is(block.raw![offset + 3], problem.portPenalty?.[port] ?? 0) ||
      !Object.is(block.raw![offset + 4], incident?.[0] ?? NaN) ||
      !Object.is(block.raw![offset + 5], incident?.[1] ?? NaN)
  }
  if (!changed) return false
  block.minX = block.minY = block.minPenalty = Infinity
  block.maxX = block.maxY = -Infinity
  block.validGeometry = true
  block.hasGoal = false
  block.maxBest = Infinity
  block.maxKnown = false
  block.dirty = true
  block.built = true
  for (let i = block.start; i < block.end; i++) {
    const port = frontier.neighbors[i]!
    const x = topology.portX[port]!
    const y = topology.portY[port]!
    const penalty = problem.portPenalty?.[port] ?? 0
    const incident = topology.incidentPortRegion[port]
    const offset = (i - block.start) * 6
    if (block.raw) {
      block.raw[offset] = port
      block.raw[offset + 1] = x
      block.raw[offset + 2] = y
      block.raw[offset + 3] = penalty
      block.raw[offset + 4] = incident?.[0] ?? NaN
      block.raw[offset + 5] = incident?.[1] ?? NaN
    }
    block.hasGoal ||= port === state.goalPortId
    block.validGeometry &&= Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(penalty)
    block.minX = Math.min(block.minX, x); block.maxX = Math.max(block.maxX, x)
    block.minY = Math.min(block.minY, y); block.maxY = Math.max(block.maxY, y)
    block.minPenalty = Math.min(block.minPenalty, penalty)
  }
  return true
}

function refreshMaximum(host: Host, block: Block): void {
  let maximum = -Infinity
  for (const hop of block.hopIds) {
    const best = host.getCandidateBestCost(hop)
    // Unknown costs cannot certify native `lower >= best`, even if the
    // geometric lower bound overflows to Infinity. NaN disables the bound.
    if (typeof best !== "number" || Number.isNaN(best)) { maximum = NaN; break }
    maximum = Math.max(maximum, best)
  }
  block.maxBest = maximum
  block.maxKnown = true
  block.dirty = false
}

export function installTinyRegionalBlockPruning(
  solver: TinyHyperGraphSolver,
  diagnostics: TinyRegionalBlockDiagnostics,
  collectWork = false,
  validateContents = false,
  observeNativeOnly = false,
): void {
  if (installed.has(solver)) return
  installed.add(solver)
  const host = solver as unknown as Host
  if (host.expandRegionalHopFrontier !== nativeExpand || host.computeG !== nativeCost || host.getCandidateBestCost !== nativeGetBest || host.setCandidateBestCost !== nativeSetBest || host.getHopId !== nativeHop || host.resetCandidateBestCosts !== nativeReset) {
    diagnostics.regionalBlockCustomSolvers++
    return
  }
  diagnostics.regionalBlockInstalledSolvers++
  if (collectWork) diagnostics.regionalBlockWorkEnabled = 1
  if (validateContents) diagnostics.regionalBlockContentValidationEnabled = 1
  // This is the same immutable-metadata ownership contract required by native
  // core.ts OWNED_REGIONAL_HOP_FRONTIER (lines269-282). Content validation is
  // an explicit diagnostic mode for callers testing edits outside that domain.
  let indexes = new WeakMap<Frontier, BlockIndex>()
  const reverse = new Map<number, Set<Block>>()
  const latestFrontiers = new Map<number, Frontier>()
  let activeBlocks = 0
  let activeMemberships = 0
  let context: Context | undefined
  const clearIndexes = (): void => {
    indexes = new WeakMap()
    if (collectWork) diagnostics.regionalBlockRegistryEntriesDiscarded += reverse.size
    reverse.clear()
    latestFrontiers.clear()
    activeBlocks = activeMemberships = 0
    context = undefined
    if (collectWork) diagnostics.regionalBlockContextResets++
  }
  const dropIndex = (frontier: Frontier): void => {
    const index = indexes.get(frontier)
    if (!index) return
    for (const block of index.blocks) for (const hop of block.hopIds) {
      if (collectWork) diagnostics.regionalBlockCleanupVisits++
      const owners = reverse.get(hop)!
      owners.delete(block)
      activeMemberships--
      if (owners.size === 0) reverse.delete(hop)
    }
    indexes.delete(frontier)
    activeBlocks -= index.blocks.length
  }
  const factory = host.createGreedyFinalRouteSolver
  host.createGreedyFinalRouteSolver = function(options, attempt): TinyHyperGraphSolver {
    const child = factory.call(this, options, attempt)
    installTinyRegionalBlockPruning(child, diagnostics, collectWork, validateContents, observeNativeOnly)
    return child
  }
  if (observeNativeOnly) {
    host.expandRegionalHopFrontier = function(candidate, frontier): void {
      // Default-off operation observation. The original expansion still runs.
      // Stop at its first eligible goal, including rejected acceptance attempts.
      if (this.OWNED_REGIONAL_HOP_FRONTIER && this.ADD_SEGMENT_DISTANCE_TO_G && frontier.neighbors.length >= MIN_PORTS && Number.isFinite(this.DISTANCE_TO_COST) && this.DISTANCE_TO_COST >= 0) {
        diagnostics.regionalBlockNativeObservedExpansions++
        for (let i = frontier.head; i !== -1; i = frontier.next[i]!) {
          diagnostics.regionalBlockNativeObservedOccurrences++
          const port = frontier.neighbors[i]!
          if (port === this.state.goalPortId && !this.isPortReservedForDifferentNet(port)) {
            const owner = this.state.portAssignment[port]
            if (owner === -1 || owner === this.state.currentRouteNetId) break
          }
        }
      }
      nativeExpand.call(this, candidate, frontier)
    }
    return
  }
  const setBestWithPrevious = (receiver: Host, hop: number, value: number, previous: number): void => {
    nativeSetBest.call(receiver, hop, value)
    if (!(value <= previous)) {
      clearIndexes()
      return
    }
    const blocks = reverse.get(hop)
    if (blocks) for (const block of blocks) {
      if (collectWork) diagnostics.regionalBlockReverseVisits++
      if (previous === block.maxBest && !block.dirty) {
        block.dirty = true
        if (collectWork) diagnostics.regionalBlockDirtyWrites++
      }
    }
  }
  host.setCandidateBestCost = function(hop, value): void {
    if (collectWork) diagnostics.regionalBlockSetterBestReads++
    setBestWithPrevious(this, hop, value, nativeGetBest.call(this, hop))
  }
  host.resetCandidateBestCosts = function(): void {
    nativeReset.call(this)
    // The native uint32 generation may wrap back to a previously seen value.
    clearIndexes()
  }
  host.expandRegionalHopFrontier = function(candidate, frontier): void {
    if (!this.OWNED_REGIONAL_HOP_FRONTIER || !this.ADD_SEGMENT_DISTANCE_TO_G || frontier.neighbors.length < MIN_PORTS || !Number.isFinite(this.DISTANCE_TO_COST) || this.DISTANCE_TO_COST < 0) {
      dropIndex(frontier)
      nativeExpand.call(this, candidate, frontier)
      return
    }
    const { state, topology, problem } = this
    if (collectWork) diagnostics.regionalBlockExpansions++
    const queueEpoch = (state.candidateQueue as { closureEpoch?: unknown }).closureEpoch
    if (!context || context.state !== state || context.generation !== state.candidateBestCostGeneration || context.best !== state.candidateBestCostByHopId || context.stamps !== state.candidateBestCostGenerationByHopId || context.goal !== state.goalPortId || context.route !== state.currentRouteId || context.net !== state.currentRouteNetId || context.queue !== state.candidateQueue || context.queueEpoch !== queueEpoch || context.topology !== topology || context.problem !== problem || context.x !== topology.portX || context.y !== topology.portY || context.penalty !== problem.portPenalty || context.incidents !== topology.incidentPortRegion || context.regions !== topology.regionIncidentPorts) {
      clearIndexes()
      context = { state, generation: state.candidateBestCostGeneration, best: state.candidateBestCostByHopId, stamps: state.candidateBestCostGenerationByHopId, goal: state.goalPortId, route: state.currentRouteId, net: state.currentRouteNetId, queue: state.candidateQueue, queueEpoch, topology, problem, x: topology.portX, y: topology.portY, penalty: problem.portPenalty, incidents: topology.incidentPortRegion, regions: topology.regionIncidentPorts }
    }
    const previousFrontier = latestFrontiers.get(candidate.nextRegionId)
    if (previousFrontier && previousFrontier !== frontier) dropIndex(previousFrontier)
    latestFrontiers.set(candidate.nextRegionId, frontier)
    let index = indexes.get(frontier)
    if (index && (index.next !== frontier.next || index.neighbors !== frontier.neighbors)) {
      dropIndex(frontier)
      index = undefined
    }
    if (!index) {
      const blocks: Block[] = []
      for (let start = 0; start < frontier.next.length; start += BLOCK_SIZE) {
        const end = Math.min(start + BLOCK_SIZE, frontier.next.length)
        blocks.push({ start, end, first: -1, last: -1, live: 0, raw: validateContents ? new Float64Array((end - start) * 6).fill(NaN) : undefined, hopIds: [], built: false, dirty: true, minX: 0, maxX: 0, minY: 0, maxY: 0, minPenalty: 0, maxBest: Infinity, maxKnown: false, validGeometry: false, hasGoal: false })
      }
      for (let i = frontier.head; i !== -1; i = frontier.next[i]!) {
        const block = blocks[Math.floor(i / BLOCK_SIZE)]!
        if (block.first === -1) block.first = i
        block.last = i; block.live++
      }
      index = { blocks, next: frontier.next, neighbors: frontier.neighbors }
      activeBlocks += blocks.length
      diagnostics.regionalBlockMaximumActiveBlocks = Math.max(diagnostics.regionalBlockMaximumActiveBlocks, activeBlocks)
      indexes.set(frontier, index)
      diagnostics.regionalBlockIndexes++
      if (validateContents) diagnostics.regionalBlockTypedPayloadBytes += frontier.next.length * 48
    }
    const { neighbors, next } = frontier
    let neighborIndex = frontier.head
    let previousNeighborIndex = -1
    while (neighborIndex !== -1) {
      const block = index.blocks[Math.floor(neighborIndex / BLOCK_SIZE)]!
      if (neighborIndex === block.first) {
        if (collectWork) {
          diagnostics.regionalBlockQueries++
          if (validateContents || !block.built) diagnostics.regionalBlockMetadataReads += block.end - block.start
        }
        if (refreshGeometry(this, frontier, block, validateContents)) {
          for (const hop of block.hopIds) {
            if (collectWork) diagnostics.regionalBlockCleanupVisits++
            const owners = reverse.get(hop)!
            owners.delete(block)
            activeMemberships--
            if (owners.size === 0) reverse.delete(hop)
          }
          block.hopIds = []
          for (let i = block.start; i < block.end; i++) {
            if (collectWork) diagnostics.regionalBlockHopBuildVisits++
            const port = frontier.neighbors[i]!
            const incidents = topology.incidentPortRegion[port]
            const nextRegion = incidents?.[0] === candidate.nextRegionId ? incidents?.[1] : incidents?.[0]
            if (nextRegion === undefined) continue
            const hop = this.getHopId(port, nextRegion)
            let owners = reverse.get(hop)
            if (!owners) { owners = new Set(); reverse.set(hop, owners) }
            // Occurrences remain untouched. Reverse membership and its maximum
            // are set-valued; duplicate ports must not be unregistered twice.
            if (owners.has(block)) continue
            block.hopIds.push(hop)
            owners.add(block)
            activeMemberships++
            if (collectWork) diagnostics.regionalBlockHopMappings++
          }
          diagnostics.regionalBlockMaximumReverseHops = Math.max(diagnostics.regionalBlockMaximumReverseHops, reverse.size)
          diagnostics.regionalBlockMaximumActiveMemberships = Math.max(diagnostics.regionalBlockMaximumActiveMemberships, activeMemberships)
        }
        if (block.validGeometry && !block.hasGoal && Number.isFinite(topology.portX[candidate.portId]) && Number.isFinite(topology.portY[candidate.portId])) {
          const x = topology.portX[candidate.portId]!
          const y = topology.portY[candidate.portId]!
          const lower = regionalBlockLowerBound(x, y, candidate.g, state.regionCongestionCost[candidate.nextRegionId]!, this.DISTANCE_TO_COST, block)
          let prune = block.maxKnown && lower >= block.maxBest
          if (!prune && block.dirty) {
            refreshMaximum(this, block)
            if (collectWork) diagnostics.regionalBlockBestRefreshReads += block.hopIds.length
            prune = lower >= block.maxBest
          }
          if (prune) {
            if (collectWork) { diagnostics.regionalBlockPrunes++; diagnostics.regionalBlockPrunedOccurrences += block.live }
            previousNeighborIndex = block.last
            neighborIndex = next[block.last]!
            continue
          }
        }
      }
      const currentNeighborIndex = neighborIndex
      neighborIndex = next[currentNeighborIndex]!
      const previousIndex = previousNeighborIndex
      previousNeighborIndex = currentNeighborIndex
      const neighborPortId = neighbors[currentNeighborIndex]!
      if (collectWork) diagnostics.regionalBlockLeafVisits++
      if (neighborPortId === state.goalPortId) {
        const assignedNetId = state.portAssignment[neighborPortId]
        if (this.isPortReservedForDifferentNet(neighborPortId)) continue
        if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) continue
        this.onPathFound(candidate)
        return
      }
      if (neighborPortId === candidate.portId) continue
      if (problem.portSectionMask[neighborPortId] === 0) continue
      const nextRegionId = topology.incidentPortRegion[neighborPortId][0] === candidate.nextRegionId ? topology.incidentPortRegion[neighborPortId][1] : topology.incidentPortRegion[neighborPortId][0]
      if (nextRegionId === undefined) continue
      const candidateHopId = this.getHopId(neighborPortId, nextRegionId)
      const candidateHopIsClosed = state.candidateQueue.isClosedHopId ? state.candidateQueue.isClosedHopId(candidateHopId) : state.candidateQueue.isClosedHop?.(neighborPortId, nextRegionId)
      if (candidateHopIsClosed === true) {
        if (previousIndex === -1) frontier.head = neighborIndex
        else next[previousIndex] = neighborIndex
        block.live--
        if (block.first === currentNeighborIndex) block.first = neighborIndex !== -1 && neighborIndex < block.end ? neighborIndex : -1
        if (block.last === currentNeighborIndex) block.last = previousIndex >= block.start ? previousIndex : -1
        previousNeighborIndex = previousIndex
        continue
      }
      const assignedNetId = state.portAssignment[neighborPortId]
      if (this.isPortReservedForDifferentNet(neighborPortId)) continue
      if (assignedNetId !== -1 && assignedNetId !== state.currentRouteNetId) continue
      if (this.isRegionReservedForDifferentNet(nextRegionId)) continue
      const previousBestCost = this.getCandidateBestCost(candidateHopId)
      if (candidate.g >= previousBestCost) continue
      const lowerBoundWithoutDistance = candidate.g + state.regionCongestionCost[candidate.nextRegionId]! + (problem.portPenalty?.[neighborPortId] ?? 0)
      let knownSegmentDistance: number | undefined
      let lowerBoundCost = lowerBoundWithoutDistance
      if (this.ADD_SEGMENT_DISTANCE_TO_G) {
        const dx = topology.portX[candidate.portId]! - topology.portX[neighborPortId]!
        const dy = topology.portY[candidate.portId]! - topology.portY[neighborPortId]!
        knownSegmentDistance = Math.sqrt(dx * dx + dy * dy)
        lowerBoundCost += knownSegmentDistance * this.DISTANCE_TO_COST
      }
      if (lowerBoundCost >= previousBestCost) continue
      const g = this.computeG(candidate, neighborPortId, previousBestCost, knownSegmentDistance)
      if (!Number.isFinite(g) || g >= previousBestCost) continue
      const h = this.computeH(neighborPortId)
      const newCandidate = { hopId: candidateHopId, prevRegionId: candidate.nextRegionId, nextRegionId, portId: neighborPortId, g, h, f: g + h, prevCandidate: candidate }
      if (neighborPortId === state.goalPortId) { this.onPathFound(newCandidate); return }
      // Known native-owned scoring is pure. Reuse the exact previous value
      // already read above; preserve the native setter and dirty notification.
      setBestWithPrevious(this, candidateHopId, g, previousBestCost)
      state.candidateQueue.queue(newCandidate)
    }
  }
}
