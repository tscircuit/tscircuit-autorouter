import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"
import type { Candidate, TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { IndexedCandidateHeap } from "tiny-hypergraph/lib/indexed-candidate-heap"
import type { RegionIntersectionCache } from "tiny-hypergraph/lib/types"
import { PreparedRoutingGeometry } from "./PreparedRoutingGeometry"

type Frontier = {
  neighbors: number[]
  next: Int32Array
  nextRegions: Int32Array
  hops: Int32Array
  head: number
}
type CostRow = {
  cache: RegionIntersectionCache
  via: number
  density: number
  single: boolean
  costs: Float64Array
}

/** Specialize dense full-route expansion without changing ordering or costs. */
export class DenseRoutingWorkspace {
  private epoch?: object
  private generation = -1
  private readonly frontiers = new Map<number, Frontier>()
  private readonly rows: Array<CostRow | undefined> = []

  constructor(readonly geometry: PreparedRoutingGeometry) {}

  step(solver: TinyHyperGraphSolver): boolean {
    const { topology: t, problem: p, state } = solver
    const queue = state.candidateQueue
    if (!this.geometry.supported || state.currentRouteId === undefined ||
        !(queue instanceof IndexedCandidateHeap) ||
        !(state.candidateBestCostByHopId instanceof Float64Array) ||
        !(state.candidateBestCostGenerationByHopId instanceof Uint32Array)) return false
    this.geometry.prepare()
    if (this.epoch !== queue.closureEpoch || this.generation !== state.candidateBestCostGeneration) {
      this.epoch = queue.closureEpoch
      this.generation = state.candidateBestCostGeneration
      this.frontiers.clear()
    }
    const c = queue.dequeue()
    if (!c) { solver.onOutOfCandidates(); return true }
    const hop = c.hopId ?? solver.getHopId(c.portId, c.nextRegionId)
    if (c.g > solver.getCandidateBestCost(hop) || solver.isRegionReservedForDifferentNet(c.nextRegionId)) return true
    const region = c.nextRegionId
    const net = state.currentRouteNetId!
    const goal = state.goalPortId
    const assign = state.portAssignment
    const reserved = solver.problemSetup.portEndpointReservationNetId
    const regionNet = p.regionNetId
    let frontier = this.frontiers.get(region)
    if (!frontier) {
      const neighbors = t.regionIncidentPorts[region]!
      const next = new Int32Array(neighbors.length).fill(-1)
      const nextRegions = new Int32Array(neighbors.length)
      const hops = new Int32Array(neighbors.length)
      let head = -1
      let previous = -1
      for (let index = 0; index < neighbors.length; index++) {
        const port = neighbors[index]!
        const reservation = reserved[port]!
        if (reservation === -2 || (reservation !== -1 && reservation !== net) ||
            (assign[port] !== -1 && assign[port] !== net)) continue
        let nextRegion = region
        if (port !== goal) {
          if (p.portSectionMask[port] === 0) continue
          const incident = t.incidentPortRegion[port]!
          const opposite = incident[0] === region ? incident[1] : incident[0]
          if (opposite === undefined || (regionNet[opposite] !== -1 && regionNet[opposite] !== net)) continue
          nextRegion = opposite
        }
        nextRegions[index] = nextRegion
        hops[index] = solver.getHopId(port, nextRegion)
        if (previous === -1) head = index
        else next[previous] = index
        previous = index
      }
      frontier = {neighbors, next, nextRegions, hops, head}
      this.frontiers.set(region, frontier)
    }
    this.expand(solver, c, frontier)
    return true
  }

  private expand(solver: TinyHyperGraphSolver, c: Candidate, frontier: Frontier): void {
    const {topology: t, problem: p, state} = solver
    const region = c.nextRegionId
    const cache = state.regionIntersectionCaches[region]!
    let row = this.rows[region]
    if (!row || row.cache !== cache || row.via !== solver.minViaPadDiameter || row.density !== solver.TRACE_DENSITY_COST_FACTOR) {
      const mask = t.regionAvailableZMask?.[region] ?? 0
      row = {cache, via: solver.minViaPadDiameter, density: solver.TRACE_DENSITY_COST_FACTOR,
        single: mask > 0 && (mask & (mask - 1)) === 0,
        costs: new Float64Array(2 * cache.netIds.length + 2)}
      // Multi-layer cost depends on 2*same + crossing + entry/exit. Single-layer
      // new crossings are rejected below, so the same table is exact there too.
      for (let count = 0; count < row.costs.length; count++) {
        row.costs[count] = computeRegionCost(t.regionWidth[region]!, t.regionHeight[region]!,
          cache.existingSameLayerIntersections, cache.existingCrossingLayerIntersections + count,
          cache.existingEntryExitLayerChanges, cache.existingSegmentCount + 1,
          mask, row.via, row.density) - cache.existingRegionCost
      }
      this.rows[region] = row
    }
    const {neighbors, next, nextRegions, hops} = frontier
    const best = state.candidateBestCostByHopId as Float64Array
    const seen = state.candidateBestCostGenerationByHopId as Uint32Array
    const generation = state.candidateBestCostGeneration
    const net = state.currentRouteNetId
    const queue = state.candidateQueue as IndexedCandidateHeap
    const offset = this.geometry.rowOffsets[2 * c.portId + (t.incidentPortRegion[c.portId]![0] === region ? 0 : 1)]!
    const distances = this.geometry.distances!
    const ua = t.incidentPortRegion[c.portId]![0] === region ? t.portAngleForRegion1[c.portId]! : (t.portAngleForRegion2?.[c.portId] ?? t.portAngleForRegion1[c.portId]!)
    const uz = t.portZ[c.portId]!
    const {netIds: nets, lesserAngles: lower, greaterAngles: upper, layerMasks: layers} = cache
    const congestion = state.regionCongestionCost[region]!
    const base = c.g + congestion
    let index = frontier.head
    let previous = -1
    while (index !== -1) {
      const at = index
      index = next[at]!
      const before = previous
      previous = at
      const port = neighbors[at]!
      if (port === state.goalPortId) { solver.onPathFound(c); return }
      if (port === c.portId) continue
      const hop = hops[at]!
      if (queue.isClosedHopId(hop)) {
        if (before === -1) frontier.head = index
        else next[before] = index
        previous = before
        continue
      }
      const old = seen[hop] === generation ? best[hop]! : Infinity
      if (c.g >= old) continue
      const distanceCost = distances[offset + at]! * solver.DISTANCE_TO_COST
      const penalty = p.portPenalty?.[port] ?? 0
      if (base + penalty + distanceCost >= old) continue
      const vz = t.portZ[port]!
      const va = t.incidentPortRegion[port]![0] === region ? t.portAngleForRegion1[port]! : (t.portAngleForRegion2?.[port] ?? t.portAngleForRegion1[port]!)
      const lo = Math.min(ua, va), hi = Math.max(ua, va), mask = (1 << uz) | (1 << vz)
      let same = 0, cross = 0
      for (let i = 0; i < nets.length; i++) {
        if (nets[i] === net) continue
        if ((lo < lower[i]! && lower[i]! < hi) === (lo < upper[i]! && upper[i]! < hi)) continue
        if (mask & layers[i]!) same++
        else cross++
      }
      if (same > 0 && row.single) continue
      // Preserve the native addition order, including roundoff and heap ties.
      const g = c.g + row.costs[2 * same + cross + (uz !== vz ? 1 : 0)]! + congestion + penalty + distanceCost
      if (!Number.isFinite(g) || g >= old) continue
      const h = solver.computeH(port)
      seen[hop] = generation
      best[hop] = g
      queue.queue({hopId: hop, prevRegionId: region, nextRegionId: nextRegions[at]!, portId: port, g, h, f: g + h, prevCandidate: c})
    }
  }
}
