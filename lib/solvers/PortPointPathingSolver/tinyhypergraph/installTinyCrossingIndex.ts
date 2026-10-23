import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import type { Candidate, TinyHyperGraphSolverOptions, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import type { RegionIntersectionCache } from "tiny-hypergraph/lib/types"
import { TinyRegionCrossingIndex, type TinyCrossingIndexDiagnostics } from "./TinyRegionCrossingIndex"

type NativeScoreHost = TinyHyperGraphSolver & {
  ADD_SEGMENT_DISTANCE_TO_G: boolean
  computeRegionCostForRegion(region: number, same: number, crossing: number, changes: number, count: number): number
  createGreedyFinalRouteSolver(options: TinyHyperGraphSolverOptions, attempt: number): TinyHyperGraphSolver
}
type RegionQueries = { angles: Int32Array; layers: Int32Array }
type IndexRecord = { source: RegionIntersectionCache; index: TinyRegionCrossingIndex }
type TopologySlots = {
  firstRegion: Int32Array
  firstSlot: Int32Array
  secondSlot: Int32Array
  regions: RegionQueries[]
}

const topologySlots = new WeakMap<TinyHyperGraphTopology, TopologySlots>()
const installedSolvers = new WeakSet<TinyHyperGraphSolver>()

/** Native P9 topology is fixed after loading and has at most two incidences. */
function getTopologySlots(topology: TinyHyperGraphTopology): TopologySlots | undefined {
  const existing = topologySlots.get(topology)
  if (existing) return existing
  if (topology.incidentPortRegion.some(regions => regions.length > 2)) return undefined
  const firstRegion = Int32Array.from(topology.incidentPortRegion, regions => regions[0] ?? -1)
  const firstSlot = new Int32Array(topology.portCount).fill(-1)
  const secondSlot = new Int32Array(topology.portCount).fill(-1)
  const regions = topology.regionIncidentPorts.map((ports, regionId) => {
    const angles = new Int32Array(ports.length)
    const layers = new Int32Array(ports.length)
    for (let slot = 0; slot < ports.length; slot++) {
      const portId = ports[slot]!
      const incident = topology.incidentPortRegion[portId]!
      angles[slot] = incident[0] === regionId || incident[1] !== regionId
        ? topology.portAngleForRegion1[portId]!
        : (topology.portAngleForRegion2?.[portId] ?? topology.portAngleForRegion1[portId]!)
      layers[slot] = topology.portZ[portId]!
      if (incident[0] === regionId) firstSlot[portId] = slot
      else secondSlot[portId] = slot
    }
    return { angles, layers }
  })
  const result = { firstRegion, firstSlot, secondSlot, regions }
  topologySlots.set(topology, result)
  return result
}

/**
 * Specialize owned P9 instances only; no prototype or dependency is changed.
 * Native committed endpoint arrays are immutable between replacement writes.
 * Append, rerip, partial rerip, replay and snapshot restore all replace them.
 * The four-array check also detects native bus-style cache-field replacement.
 * Deliberate external mutation of owned topology/endpoint arrays is unsupported.
 */
export function installTinyCrossingIndex(
  solver: TinyHyperGraphSolver,
  diagnostics: TinyCrossingIndexDiagnostics,
): void {
  if (installedSolvers.has(solver)) return
  installedSolvers.add(solver)
  const slots = getTopologySlots(solver.topology)
  // Preserve custom/native zero-cost scoring. Its factory still returns the
  // native type; we never replace a different computeG implementation.
  if (!slots || solver.computeG !== TinyHyperGraphSolver.prototype.computeG) {
    diagnostics.crossingIndexNativeScorerSolvers++
    return
  }
  diagnostics.crossingIndexInstalledSolvers++
  const host = solver as unknown as NativeScoreHost
  const records: Array<IndexRecord | undefined> = []
  let residentBytes = 0
  const nativeFactory = host.createGreedyFinalRouteSolver
  host.createGreedyFinalRouteSolver = function(options, attempt): TinyHyperGraphSolver {
    const child = nativeFactory.call(this, options, attempt)
    installTinyCrossingIndex(child, diagnostics)
    return child
  }
  solver.computeG = function(
    currentCandidate: Candidate,
    neighborPortId: number,
    maximumCost = Number.POSITIVE_INFINITY,
    knownSegmentDistance?: number,
  ): number {
    const { state, topology } = solver
    const nextRegionId = currentCandidate.nextRegionId
    const regionCache = state.regionIntersectionCaches[nextRegionId]!
    const regionCongestionCost = state.regionCongestionCost[nextRegionId]!
    const neighborPortPenalty = solver.problem.portPenalty?.[neighborPortId] ?? 0
    let segmentDistanceCost = 0
    if (host.ADD_SEGMENT_DISTANCE_TO_G) {
      let segmentDistance = knownSegmentDistance
      if (segmentDistance === undefined) {
        const dx = topology.portX[currentCandidate.portId]! - topology.portX[neighborPortId]!
        const dy = topology.portY[currentCandidate.portId]! - topology.portY[neighborPortId]!
        segmentDistance = Math.sqrt(dx * dx + dy * dy)
      }
      segmentDistanceCost = segmentDistance * solver.DISTANCE_TO_COST
    }
    const lowerBoundCost = currentCandidate.g + regionCongestionCost + neighborPortPenalty + segmentDistanceCost
    if (lowerBoundCost > maximumCost + 1e-9) return Number.POSITIVE_INFINITY
    let newSameLayerIntersections = 0
    let newCrossLayerIntersections = 0
    const newEntryExitLayerChanges = topology.portZ[currentCandidate.portId] !== topology.portZ[neighborPortId] ? 1 : 0
    if (regionCache.existingSegmentCount > 0) {
      let record = records[nextRegionId]
      if (!record || record.source !== regionCache || !record.index.matchesSource(regionCache)) {
        const region = slots.regions[nextRegionId]!
        const index = new TinyRegionCrossingIndex(regionCache, region.angles, region.layers, diagnostics)
        residentBytes += index.byteLength - (record?.index.byteLength ?? 0)
        diagnostics.crossingIndexMaximumSolverTableBytes = Math.max(diagnostics.crossingIndexMaximumSolverTableBytes, residentBytes)
        record = { source: regionCache, index }
        records[nextRegionId] = record
      }
      const fromPortId = currentCandidate.portId
      const fromSlot = slots.firstRegion[fromPortId] === nextRegionId ? slots.firstSlot[fromPortId]! : slots.secondSlot[fromPortId]!
      const toSlot = slots.firstRegion[neighborPortId] === nextRegionId ? slots.firstSlot[neighborPortId]! : slots.secondSlot[neighborPortId]!
      record.index.count(fromSlot, toSlot, state.currentRouteNetId!)
      newSameLayerIntersections = record.index.sameLayerIntersectionCount
      newCrossLayerIntersections = record.index.crossingLayerIntersectionCount
    }
    if (newSameLayerIntersections > 0 && solver.isKnownSingleLayerRegion(nextRegionId)) return Number.POSITIVE_INFINITY
    // Keep the native calls, subtraction and addition order exactly. Only the
    // integer crossing counts above have a different representation.
    const newRegionCost = host.computeRegionCostForRegion(
      nextRegionId,
      regionCache.existingSameLayerIntersections + newSameLayerIntersections,
      regionCache.existingCrossingLayerIntersections + newCrossLayerIntersections,
      regionCache.existingEntryExitLayerChanges + newEntryExitLayerChanges,
      regionCache.existingSegmentCount + 1,
    ) - regionCache.existingRegionCost
    return currentCandidate.g + newRegionCost + regionCongestionCost + neighborPortPenalty + segmentDistanceCost
  }
}
