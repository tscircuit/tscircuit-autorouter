import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { IndexedCandidateHeap } from "tiny-hypergraph/lib/indexed-candidate-heap"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"
import type { Candidate } from "tiny-hypergraph/lib/core"
import { IncrementalHopSearch, type HopSearchGraph } from "./IncrementalHopSearch"

export type IncrementalPathStats = {
  activated: number
  queryStarts: number
  repeatedQueries: number
  eligibleQueries: number
  unsupportedQueries: number
  budgetDeclinedQueries: number
  freshSearches: number
  repairs: number
  changedCostReuseQueries: number
  changedTransitions: number
  reusedLabels: number
  repairedLabels: number
  dependencyVisits: number
  generatedTransitions: number
  chargedWork: number
  solvedQueries: number
}

export type IncrementalPathScope = {
  solverInstances: number
  portCount: number
  regionCount: number
  estimatedTransitions: number
  hopVertices: number
  topologyEligible: number
  maximumVertices: number
  maximumTransitions: number
  maximumQueries: number
  prefixDeclinedQueries: number
  arithmeticDeclinedQueries: number
  changedRepairQueries: number
  changedRepairReusedLabels: number
  unreachableQueries: number
}

type Hop = { port: number; region: number }
type EdgeGeometry = { region: number; fromPort: number; toPort: number; nextRegion: number; terminal: boolean }
type QueryCache = { search: IncrementalHopSearch; signatures: string[] }

/**
 * Owned specialization of pinned tiny-hypergraph ec80c91 prepared full-route
 * search. Native initialization, rerip/acceptance and unsupported searches stay
 * native. The finite graph uses (entry port,next region), never HD XYZ states.
 * Partial/outside-in prefixes are deliberately outside this graph contract.
 */
export class IncrementalPreparedPortPointRoutingSolver extends PreparedPortPointRoutingSolver {
  readonly incrementalPath: IncrementalPathStats = {
    activated: 0, queryStarts: 0, repeatedQueries: 0, eligibleQueries: 0,
    unsupportedQueries: 0, budgetDeclinedQueries: 0, freshSearches: 0,
    repairs: 0, changedCostReuseQueries: 0, changedTransitions: 0, reusedLabels: 0, repairedLabels: 0,
    dependencyVisits: 0, generatedTransitions: 0, chargedWork: 0,
    solvedQueries: 0,
  }
  readonly incrementalPathScope: IncrementalPathScope
  private readonly maximumVertices = 32_768
  private readonly maximumTransitions = 65_536
  private readonly maximumQueries = 32
  private readonly queryVisits = new Map<string, number>()
  private readonly queries = new Map<string, QueryCache>()
  private graph?: HopSearchGraph
  private readonly hops: Hop[] = []
  private readonly edges: EdgeGeometry[] = []
  private readonly edgesByRegion: number[][] = []
  private readonly hopByKey = new Map<string, number>()
  private active?: Generator<void, void>
  private observedEpoch?: object
  private observedGeneration = -1
  private currentPolicy: "native" | "incremental" = "native"
  private committing = false
  private readonly structurallyEligible: boolean
  private readonly originalPortX: Float64Array
  private readonly originalPortY: Float64Array
  private readonly topologyIncidenceKey: string
  private asyncStopAtIteration = Infinity

  constructor(...params: ConstructorParameters<typeof PreparedPortPointRoutingSolver>) {
    super(...params)
    let count = 0, work = 0
    for (const ports of this.topology.regionIncidentPorts) {
      count += ports.length * ports.length + ports.length
      work++
    }
    let ordinaryIncidence = true, hopVertices = 1
    for (const regions of this.topology.incidentPortRegion) {
      ordinaryIncidence &&= regions.length <= 2
      hopVertices += regions.length
      work++
    }
    this.structurallyEligible = ordinaryIncidence && count <= this.maximumTransitions && hopVertices <= this.maximumVertices
    this.originalPortX = this.topology.portX.slice()
    this.originalPortY = this.topology.portY.slice()
    this.topologyIncidenceKey = JSON.stringify([this.topology.regionIncidentPorts, this.topology.incidentPortRegion])
    this.incrementalPathScope = {
      solverInstances: 1, portCount: this.topology.portCount, regionCount: this.topology.regionCount,
      estimatedTransitions: count, hopVertices, topologyEligible: Number(this.structurallyEligible),
      maximumVertices: this.maximumVertices, maximumTransitions: this.maximumTransitions, maximumQueries: this.maximumQueries,
      prefixDeclinedQueries: 0, arithmeticDeclinedQueries: 0, changedRepairQueries: 0, changedRepairReusedLabels: 0, unreachableQueries: 0,
    }
    this.incrementalPath.dependencyVisits += work
    this.incrementalPath.chargedWork += work
    this.iterations += work
    this.stats = { ...this.stats, incrementalPath: this.incrementalPath, incrementalPathScope: this.incrementalPathScope }
  }

  private observeQuery(): string {
    const route = this.state.currentRouteId
    if (route === undefined) throw new Error("Incremental observation lacks current route")
    const start = this.getRouteStartPortId(route)
    const region = this.getStartingNextRegionId(route, start)
    const key = `${route}/${this.state.currentRouteNetId}/${start}/${region}/${this.state.goalPortId}`
    const queue = this.state.candidateQueue
    if (queue instanceof IndexedCandidateHeap && (queue.closureEpoch !== this.observedEpoch || this.state.candidateBestCostGeneration !== this.observedGeneration)) {
      this.observedEpoch = queue.closureEpoch
      this.observedGeneration = this.state.candidateBestCostGeneration
      this.currentPolicy = "native"
      const visits = this.queryVisits.get(key) ?? 0
      this.incrementalPath.queryStarts++
      this.incrementalPath.repeatedQueries += Number(visits > 0)
      this.queryVisits.set(key, visits + 1)
    }
    return key
  }

  override onPathFound(candidate: Candidate): void {
    if (!this.committing) this.observeQuery()
    super.onPathFound(candidate)
    this.stats = { ...this.stats, incrementalPath: this.incrementalPath, incrementalPathScope: this.incrementalPathScope }
  }

  override onOutOfCandidates(): void {
    if (!this.committing) this.observeQuery()
    super.onOutOfCandidates()
    this.stats = { ...this.stats, incrementalPath: this.incrementalPath, incrementalPathScope: this.incrementalPathScope }
  }

  override _step(): void {
    if (this.active) {
      this.advanceWork()
      return
    }
    if (this.state.currentRouteId === undefined) {
      super._step()
      return
    }
    const priorEpoch = this.observedEpoch, priorGeneration = this.observedGeneration
    const key = this.observeQuery()
    const newQuery = priorEpoch !== this.observedEpoch || priorGeneration !== this.observedGeneration
    if (!newQuery || this.currentPolicy === "incremental") {
      super._step()
      return
    }
    // Establish actual repeated-query demand before allocating a hop graph or
    // LPA labels. The first query uses precisely the prepared native search.
    if (this.queryVisits.get(key) === 1) {
      super._step()
      return
    }
    const route = this.state.currentRouteId
    if (!this.structurallyEligible || !(this.state.candidateQueue instanceof IndexedCandidateHeap) || this.partialRipRoutePlans.has(route) || this.OUTSIDE_IN_ROUTING || this.getRouteStartPortId(route) === this.state.goalPortId) {
      this.incrementalPath.unsupportedQueries++
      this.incrementalPathScope.prefixDeclinedQueries += Number(this.partialRipRoutePlans.has(route) || this.OUTSIDE_IN_ROUTING)
      super._step()
      return
    }
    // Admission is before incremental search, never recovery after a failure.
    const reserve = this.graph ? this.graph.vertexCount * 2 : this.topology.portCount * 8
    if (this.MAX_ITERATIONS - this.iterations <= reserve) {
      this.incrementalPath.budgetDeclinedQueries++
      super._step()
      return
    }
    this.currentPolicy = "incremental"
    this.active = this.runQuery(key)
    this.advanceWork()
  }

  private advanceWork(): void {
    if (!this.active) throw new Error("Missing incremental work iterator")
    let consumed = 0
    const available = Math.max(1, Math.min(32, this.MAX_ITERATIONS - this.iterations + 1, this.asyncStopAtIteration - this.iterations + 1))
    while (consumed < available) {
      const next = this.active.next()
      if (next.done) {
        this.active = undefined
        break
      }
      consumed++
    }
    // BaseSolver.step already charged one iteration. Every yielded generation,
    // dependency, edge update, label scan and relaxation consumes the same budget.
    this.iterations += Math.max(0, consumed - 1)
    this.incrementalPath.chargedWork += consumed
    this.stats = { ...this.stats, incrementalPath: this.incrementalPath, incrementalPathScope: this.incrementalPathScope }
  }

  override async solveAsync(runtime?: SolverRuntimeExecutor, stopAtIteration = Infinity): Promise<void> {
    const previousStop = this.asyncStopAtIteration
    this.asyncStopAtIteration = Math.min(previousStop, stopAtIteration)
    try {
      await super.solveAsync(runtime, stopAtIteration)
    } finally {
      this.asyncStopAtIteration = previousStop
    }
  }

  private *prepareGraph(): Generator<void, void> {
    const t = this.topology
    for (let port = 0; port < t.portCount; port++) {
      for (const region of t.incidentPortRegion[port]!) {
        this.hopByKey.set(`${port}/${region}`, this.hops.length)
        this.hops.push({ port, region })
        yield
      }
    }
    const graph: HopSearchGraph = { vertexCount: this.hops.length + 1, edges: [], incoming: [], outgoing: [] }
    for (let vertex = 0; vertex < graph.vertexCount; vertex++) {
      graph.incoming.push([])
      graph.outgoing.push([])
      yield
    }
    for (let region = 0; region < t.regionCount; region++) this.edgesByRegion.push([])
    for (let from = 0; from < this.hops.length; from++) {
      const { port, region } = this.hops[from]!
      for (const neighbor of t.regionIncidentPorts[region]!) {
        if (neighbor === port) continue
        const incident = t.incidentPortRegion[neighbor]!
        const other = incident[0] === region ? incident[1] : incident[0]
        if (other === undefined) continue
        const to = this.hopByKey.get(`${neighbor}/${other}`)
        if (to === undefined) throw new Error("Missing incremental native hop")
        const edge = graph.edges.length
        graph.edges.push({ from, to })
        graph.outgoing[from]!.push(edge)
        graph.incoming[to]!.push(edge)
        this.edgesByRegion[region]!.push(edge)
        this.edges.push({ region, fromPort: port, toPort: neighbor, nextRegion: other, terminal: false })
        this.incrementalPath.generatedTransitions++
        yield
      }
      const edge = graph.edges.length, to = this.hops.length
      graph.edges.push({ from, to })
      graph.outgoing[from]!.push(edge)
      graph.incoming[to]!.push(edge)
      this.edgesByRegion[region]!.push(edge)
      this.edges.push({ region, fromPort: port, toPort: -1, nextRegion: region, terminal: true })
      this.incrementalPath.generatedTransitions++
      yield
    }
    this.graph = graph
  }

  private *getSignatures(): Generator<void, string[]> {
    const result: string[] = [], t = this.topology, p = this.problem, s = this.state
    for (let region = 0; region < t.regionCount; region++) {
      const cache = s.regionIntersectionCaches[region]!
      const values = [t.regionWidth[region], t.regionHeight[region], t.regionAvailableZMask?.[region] ?? 0,
        p.regionNetId[region], s.regionCongestionCost[region], this.minViaPadDiameter, this.TRACE_DENSITY_COST_FACTOR, this.DISTANCE_TO_COST,
        cache.existingSameLayerIntersections, cache.existingCrossingLayerIntersections, cache.existingEntryExitLayerChanges, cache.existingSegmentCount, cache.existingRegionCost]
      for (const array of [cache.netIds, cache.lesserAngles, cache.greaterAngles, cache.layerMasks]) {
        for (const value of array) { values.push(value); this.incrementalPath.dependencyVisits++; yield }
        values.push(-987654321) // array separators; lengths below disambiguate contents
        values.push(array.length)
      }
      for (const port of t.regionIncidentPorts[region]!) {
        if (t.portX[port] !== this.originalPortX[port] || t.portY[port] !== this.originalPortY[port]) {
          throw new Error("Prepared incremental routing static port geometry changed")
        }
        values.push(port, s.portAssignment[port]!, this.problemSetup.portEndpointReservationNetId[port]!, p.portSectionMask[port]!, p.portPenalty?.[port] ?? 0,
          t.portX[port]!, t.portY[port]!, t.portZ[port]!, t.portAngleForRegion1[port]!, t.portAngleForRegion2?.[port] ?? t.portAngleForRegion1[port]!)
        for (const adjacent of t.incidentPortRegion[port]!) values.push(adjacent, p.regionNetId[adjacent]!)
        this.incrementalPath.dependencyVisits++
        yield
      }
      result.push(JSON.stringify(values))
      this.incrementalPath.dependencyVisits++
      yield
    }
    return result
  }

  private *transitionCost(edge: number): Generator<void, number[] | null> {
    const e = this.edges[edge]!, t = this.topology, p = this.problem, s = this.state
    const net = s.currentRouteNetId!, goal = s.goalPortId
    if (this.isRegionReservedForDifferentNet(e.region)) return [Infinity, 0, 0, 0]
    const port = e.terminal ? goal : e.toPort
    const assigned = s.portAssignment[port]!
    if (this.isPortReservedForDifferentNet(port) || (assigned !== -1 && assigned !== net)) return [Infinity, 0, 0, 0]
    // DistanceAwareTinyHyperGraphSolver.onPathFound queues a fully scored
    // final goal hop; the Dense workspace's goal callback is not a free edge.
    if (e.terminal && !t.regionIncidentPorts[e.region]!.includes(goal)) return [Infinity, 0, 0, 0]
    if (!e.terminal && (port === goal || p.portSectionMask[port] === 0 || this.isRegionReservedForDifferentNet(e.nextRegion))) return [Infinity, 0, 0, 0]
    const cache = s.regionIntersectionCaches[e.region]!
    const angle = (at: number): number => t.incidentPortRegion[at]![0] === e.region ? t.portAngleForRegion1[at]! : (t.portAngleForRegion2?.[at] ?? t.portAngleForRegion1[at]!)
    const ua = angle(e.fromPort), va = angle(port), lo = Math.min(ua, va), hi = Math.max(ua, va)
    const uz = t.portZ[e.fromPort]!, vz = t.portZ[port]!, mask = (1 << uz) | (1 << vz)
    let same = 0, cross = 0
    for (let index = 0; index < cache.netIds.length; index++) {
      this.incrementalPath.dependencyVisits++
      yield
      if (cache.netIds[index] === net) continue
      if ((lo < cache.lesserAngles[index]! && cache.lesserAngles[index]! < hi) === (lo < cache.greaterAngles[index]! && cache.greaterAngles[index]! < hi)) continue
      if (mask & cache.layerMasks[index]!) same++
      else cross++
    }
    const layers = t.regionAvailableZMask?.[e.region] ?? 0
    if (same > 0 && layers > 0 && (layers & (layers - 1)) === 0) return [Infinity, 0, 0, 0]
    const delta = computeRegionCost(t.regionWidth[e.region]!, t.regionHeight[e.region]!, cache.existingSameLayerIntersections,
      cache.existingCrossingLayerIntersections + 2 * same + cross + Number(uz !== vz), cache.existingEntryExitLayerChanges,
      cache.existingSegmentCount + 1, layers, this.minViaPadDiameter, this.TRACE_DENSITY_COST_FACTOR) - cache.existingRegionCost
    const dx = t.portX[e.fromPort]! - t.portX[port]!, dy = t.portY[e.fromPort]! - t.portY[port]!
    const costs = [delta, s.regionCongestionCost[e.region]!, p.portPenalty?.[port] ?? 0, Math.sqrt(dx * dx + dy * dy) * this.DISTANCE_TO_COST]
    // LPA* requires nonnegative additive increments. This is an admission
    // decision before labels/costs change, not recovery after search failure.
    if (costs.some((value) => !Number.isFinite(value) || value < 0)) return null
    return costs
  }

  private *runQuery(key: string): Generator<void, void> {
    if (!this.graph) yield* this.prepareGraph()
    const graph = this.graph
    if (!graph) throw new Error("Incremental graph not prepared")
    const signatures = yield* this.getSignatures()
    // PreparedRoutingGeometry also owns immutable incidence. Reusing changed
    // topology is an invariant violation, never a silently stale LPA graph.
    if (JSON.stringify([this.topology.regionIncidentPorts, this.topology.incidentPortRegion]) !== this.topologyIncidenceKey) {
      throw new Error("Prepared incremental routing topology incidence changed")
    }
    const route = this.state.currentRouteId
    if (route === undefined) throw new Error("Incremental query lost its route")
    const startPort = this.getRouteStartPortId(route), startRegion = this.getStartingNextRegionId(route, startPort)
    const source = this.hopByKey.get(`${startPort}/${startRegion}`)
    if (source === undefined) throw new Error("Incremental source missing")
    let cached = this.queries.get(key)
    const previousChanges = cached?.search.counters.changedTransitions ?? 0
    const previousRepairedLabels = cached?.search.counters.repairedLabels ?? 0
    if (!cached) {
      const costs = new Float64Array(this.edges.length * 4)
      for (let edge = 0; edge < this.edges.length; edge++) {
        const parts = yield* this.transitionCost(edge)
        if (!parts) {
          this.currentPolicy = "native"
          this.incrementalPath.unsupportedQueries++
          this.incrementalPathScope.arithmeticDeclinedQueries++
          return
        }
        costs.set(parts, edge * 4)
        yield
      }
      this.incrementalPath.activated = 1
      this.incrementalPath.eligibleQueries++
      cached = { search: new IncrementalHopSearch(graph, source, this.hops.length), signatures }
      yield* cached.search.initialize(costs)
      this.incrementalPath.freshSearches++
      this.queries.set(key, cached)
      if (this.queries.size > this.maximumQueries) this.queries.delete(this.queries.keys().next().value!)
    } else {
      const changes: Array<{ edge: number; costs: number[] }> = []
      for (let region = 0; region < signatures.length; region++) {
        if (signatures[region] !== cached.signatures[region]) {
          for (const edge of this.edgesByRegion[region]!) {
            const parts = yield* this.transitionCost(edge)
            if (!parts) {
              this.currentPolicy = "native"
              this.incrementalPath.unsupportedQueries++
              this.incrementalPathScope.arithmeticDeclinedQueries++
              return
            }
            changes.push({ edge, costs: parts })
            yield
          }
        }
        yield
      }
      yield* cached.search.changeCosts(changes)
      this.incrementalPath.activated = 1
      this.incrementalPath.eligibleQueries++
      cached.signatures = signatures
      this.incrementalPath.repairs++
    }
    const before = { ...cached.search.counters }
    yield* cached.search.repair()
    this.incrementalPath.changedTransitions += cached.search.counters.changedTransitions - previousChanges
    this.incrementalPath.reusedLabels += cached.search.counters.reusedLabels - before.reusedLabels
    if (cached.search.counters.changedTransitions > previousChanges) {
      this.incrementalPathScope.changedRepairQueries++
      this.incrementalPathScope.changedRepairReusedLabels += cached.search.counters.reusedLabels - before.reusedLabels
      if (cached.search.counters.reusedLabels > before.reusedLabels) this.incrementalPath.changedCostReuseQueries++
    }
    this.incrementalPath.repairedLabels += cached.search.counters.repairedLabels - previousRepairedLabels
    const path = yield* cached.search.getPath()
    let candidate: Candidate | undefined
    for (const vertex of path?.slice(0, -1) ?? []) {
      const hop = this.hops[vertex]!, g = cached.search.g[vertex]!
      candidate = { hopId: this.getHopId(hop.port, hop.region), portId: hop.port, nextRegionId: hop.region,
        prevRegionId: candidate?.nextRegionId, g, h: 0, f: g, prevCandidate: candidate }
      yield
    }
    if (path && !candidate) throw new Error("Empty incremental native witness")
    if (candidate) {
      const goal = this.state.goalPortId
      candidate = { hopId: this.getHopId(goal, candidate.nextRegionId), portId: goal, nextRegionId: candidate.nextRegionId,
        prevRegionId: candidate.nextRegionId, g: cached.search.g[this.hops.length]!, h: 0, f: cached.search.g[this.hops.length]!, prevCandidate: candidate }
    }
    this.committing = true
    try {
      this.state.candidateQueue.clear()
      if (candidate) {
        this.incrementalPath.solvedQueries++
        this.onPathFound(candidate)
      } else {
        this.incrementalPathScope.unreachableQueries++
        this.onOutOfCandidates()
      }
    } finally {
      this.committing = false
    }
  }
}
