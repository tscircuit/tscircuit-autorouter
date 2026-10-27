import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import {createEmptyRegionIntersectionCache, type Candidate, type TinyHyperGraphProblem, type TinyHyperGraphSolverOptions, type TinyHyperGraphTopology} from "tiny-hypergraph/lib/core"
import type {RegionIntersectionCache} from "tiny-hypergraph/lib/types"

export type Segment = { regionId: number; fromPortId: number; toPortId: number }
export type RouteProposal = { routeId: number; segments: Segment[]; iterations: number; found: boolean }
export type RoutingSnapshot = {
  portAssignment: Int32Array
  populatedCaches: Array<[number, RegionIntersectionCache]>
  regionCongestionCost: Float64Array
}
export type RoutingInput = {
  topology: TinyHyperGraphTopology
  problem: TinyHyperGraphProblem
  options: TinyHyperGraphSolverOptions
}

/** Searches one route against immutable committed state; never commits or rips. */
export class RouteProposalSolver extends DistanceAwareTinyHyperGraphSolver {
  private proposal: Segment[] = []
  private readonly emptyCache = createEmptyRegionIntersectionCache()

  constructor(input: RoutingInput) {
    super(input.topology, input.problem, {
      ...input.options,
      STATIC_REACHABILITY_PRECHECK: false,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      PARTIAL_RIP_ENABLED: false,
      OUTSIDE_IN_ROUTING: false,
      MAX_ITERATIONS: Math.max(1, Math.ceil((input.options.MAX_ITERATIONS ?? 2_000_000) / 20)),
    })
    this.setup()
  }

  setSnapshot(snapshot: RoutingSnapshot): void {
    this.state.portAssignment = snapshot.portAssignment
    this.state.regionIntersectionCaches.fill(this.emptyCache)
    for (const [regionId, cache] of snapshot.populatedCaches) {
      this.state.regionIntersectionCaches[regionId] = cache
    }
    this.state.regionCongestionCost = snapshot.regionCongestionCost
  }

  search(routeId: number): RouteProposal {
    this.solved = false
    this.failed = false
    this.error = null
    this.iterations = 0
    this.proposal = []
    this.state.currentRouteId = undefined
    this.state.currentRouteNetId = undefined
    this.state.unroutedRoutes = [routeId]
    this.state.candidateQueue.clear()
    this.solve()
    return { routeId, segments: this.proposal, iterations: this.iterations, found: this.solved }
  }

  override onPathFound(candidate: Candidate): void {
    if (candidate.portId !== this.state.goalPortId) {
      super.onPathFound(candidate)
      return
    }
    this.proposal = this.getSolvedPathSegments(candidate)
    this.solved = true
  }

  override onOutOfCandidates(): void {
    this.failed = true
    this.error = "No route against the current snapshot"
  }

  override tryFinalAcceptance(): void {
    this.failed = true
    this.error = "Snapshot route search exhausted its expansion budget"
  }
}
