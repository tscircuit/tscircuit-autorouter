import type { Candidate, TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { OutsideInPartialRipTinyHyperGraphSolver } from "./tiny-hypergraph-fork/OutsideInPartialRipTinyHyperGraphSolver"
import type { NegotiatedPathingGraph, NegotiatedPathingRouteJob, NegotiatedPathingRouteResult, NegotiatedPathSegment } from "./parallelNegotiatedPathingTypes"

let cachedGraph: { graphId: number; graph: NegotiatedPathingGraph } | undefined

/** Runs one search against an immutable batch snapshot; it never commits shared arrays. */
export class TinyNegotiatedRouteSearch extends OutsideInPartialRipTinyHyperGraphSolver {
  private readonly mode: "cost-aware" | "greedy"
  private resultStatus?: "solved" | "exhausted" | "budget"
  private solvedSegments?: NegotiatedPathSegment[]
  readonly routeId: number

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem, job: NegotiatedPathingRouteJob) {
    // Coordinator already checked static connectivity and applies preloaded
    // assignments. Workers retain every endpoint reservation in the full problem.
    super(topology, { ...problem, initialAssignments: undefined }, {
      ...job.options, STATIC_REACHABILITY_PRECHECK: false, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
    })
    this.mode = job.mode
    this.routeId = job.routeId
    if (!Number.isInteger(job.routeId) || job.routeId < 0 || job.routeId >= problem.routeCount) {
      throw new Error(`Negotiated route search has invalid route ${job.routeId}`)
    }
    if (!Number.isSafeInteger(this.MAX_ITERATIONS) || this.MAX_ITERATIONS < 1) {
      throw new Error("Negotiated route search requires a positive expansion budget")
    }
    this.state.portAssignment = job.snapshot.portAssignment
    this.state.regionCongestionCost = job.snapshot.regionCongestionCost
    this.state.unroutedRoutes = [job.routeId]
    this.state.regionIntersectionCaches = Array.from({ length: topology.regionCount }, (_, regionId) => {
      const start = job.snapshot.regionOffsets[regionId]!
      const end = job.snapshot.regionOffsets[regionId + 1]!
      if (start > end || end > job.snapshot.netIds.length) throw new Error("Negotiated occupancy offsets are invalid")
      return { netIds: job.snapshot.netIds.subarray(start, end),
        lesserAngles: job.snapshot.lesserAngles.subarray(start, end),
        greaterAngles: job.snapshot.greaterAngles.subarray(start, end),
        layerMasks: job.snapshot.layerMasks.subarray(start, end), existingSegmentCount: end - start,
        existingSameLayerIntersections: job.snapshot.regionMetrics[regionId * 4]!,
        existingCrossingLayerIntersections: job.snapshot.regionMetrics[regionId * 4 + 1]!,
        existingEntryExitLayerChanges: job.snapshot.regionMetrics[regionId * 4 + 2]!,
        existingRegionCost: job.snapshot.regionMetrics[regionId * 4 + 3]! }
    })
    if (job.routePlan) {
      if (job.routePlan.routeId !== job.routeId) throw new Error("Negotiated partial-rip plan references another route")
      this.partialRipRoutePlans.set(job.routeId, job.routePlan)
    }
    if (job.mode === "greedy") {
      this.ADD_SEGMENT_DISTANCE_TO_G = false
      this.OUTSIDE_IN_ROUTING = false
      this.PARTIAL_RIP_ENABLED = false
    }
  }

  override computeG(candidate: Candidate, neighborPortId: number, maximumCost?: number,
    knownSegmentDistance?: number): number {
    return this.mode === "greedy" ? candidate.g : super.computeG(candidate, neighborPortId, maximumCost, knownSegmentDistance)
  }

  override onPathFound(candidate: Candidate): void {
    // DistanceAware's final hop must still be queued and costed before acceptance.
    if (this.mode === "cost-aware" && candidate.portId !== this.state.goalPortId) {
      super.onPathFound(candidate)
      return
    }
    this.solvedSegments = this.getSolvedPathSegments(candidate)
    this.resultStatus = "solved"
    this.solved = true
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
  }

  override onOutOfCandidates(): void {
    this.resultStatus = "exhausted"
    this.failed = true
    this.error = `Negotiated route ${this.routeId} exhausted its frozen occupancy search`
  }

  override tryFinalAcceptance(): void {
    this.resultStatus = "budget"
  }

  getRouteResult(): NegotiatedPathingRouteResult {
    if (this.resultStatus === "solved" && this.solvedSegments) {
      return { kind: "pathingNegotiatedRoute", routeId: this.routeId,
        status: "solved", segments: this.solvedSegments, expansions: this.iterations }
    }
    if (this.resultStatus === "exhausted" || this.resultStatus === "budget") {
      return { kind: "pathingNegotiatedRoute", routeId: this.routeId,
        status: this.resultStatus, expansions: this.iterations }
    }
    throw new Error(`Negotiated route search finished without an explicit result: ${this.error}`)
  }

  finishSharedBudget(): void {
    this.resultStatus = "budget"
  }
}

export function executeNegotiatedPathingRouteJob(job: NegotiatedPathingRouteJob): NegotiatedPathingRouteResult {
  if (job.graph) cachedGraph = { graphId: job.graphId, graph: job.graph }
  if (!cachedGraph || cachedGraph.graphId !== job.graphId) {
    throw new Error(`Negotiated pathing worker is missing graph ${job.graphId}`)
  }
  const solver = new TinyNegotiatedRouteSearch(cachedGraph.graph.topology, cachedGraph.graph.problem, job)
  if (!(job.expansionTickets.buffer instanceof SharedArrayBuffer) || job.expansionTickets.length !== 1) {
    throw new Error("Negotiated pathing worker requires a shared expansion budget")
  }
  let unusedTickets = 0
  try {
    while (!solver.solved && !solver.failed) {
      if (unusedTickets === 0) {
        let available = Atomics.load(job.expansionTickets, 0)
        if (available < 0) throw new Error("Negotiated shared expansion budget became negative")
        while (available > 0) {
          const loan = Math.min(128, available)
          const previous = Atomics.compareExchange(job.expansionTickets, 0, available, available - loan)
          if (previous === available) { unusedTickets = loan; break }
          available = previous
        }
        if (unusedTickets === 0) { solver.finishSharedBudget(); break }
      }
      solver.step()
      unusedTickets--
    }
  } finally {
    if (unusedTickets > 0) Atomics.add(job.expansionTickets, 0, unusedTickets)
  }
  return solver.getRouteResult()
}
