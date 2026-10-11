import type { TinyHyperGraphProblem, TinyHyperGraphSolver, TinyHyperGraphSolverOptions, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "./TinyIndexedSelectiveReripHyperGraphSolver"
import { TinyLandmarkHeuristic } from "./TinyLandmarkHeuristic"

export class TinyLandmarkSelectiveReripHyperGraphSolver extends TinyIndexedSelectiveReripHyperGraphSolver {
  readonly landmarkHeuristic: TinyLandmarkHeuristic

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions, landmarkHeuristic?: TinyLandmarkHeuristic) {
    super(topology, problem, options)
    this.landmarkHeuristic = landmarkHeuristic ?? new TinyLandmarkHeuristic(this)
    if (landmarkHeuristic) landmarkHeuristic.validateSolver(this)
  }

  override computeH(portId: number): number {
    const routeId = this.state.currentRouteId
    if (routeId === undefined) throw new Error("Landmark route heuristic requires an active route")
    return Math.max(super.computeH(portId),
      this.landmarkHeuristic.lowerBound(portId, this.getRouteEndPortId(routeId)))
  }

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions, attempt: number,
  ): TinyHyperGraphSolver {
    // Zero-cost greedy completion keeps its established policy; its edges do
    // not pay the geometric/region costs bounded by the landmark heuristic.
    if (attempt >= 0) return super.createGreedyFinalRouteSolver(options, attempt)
    const solver = new LandmarkCongestionAwareFinalRouteSolver(this.topology, this.problem, {
      ...options, MAX_ITERATIONS: Math.max(options.MAX_ITERATIONS ?? 50_000, this.MAX_ITERATIONS * 2),
    }, this.landmarkHeuristic)
    solver.remainingReripBudget = this.costAwareFinalReripBudget - this.state.ripCount
    return solver
  }
}

class LandmarkCongestionAwareFinalRouteSolver extends TinyLandmarkSelectiveReripHyperGraphSolver {
  remainingReripBudget = 0

  override onOutOfCandidates(): void {
    super.onOutOfCandidates()
    if (this.state.ripCount >= this.remainingReripBudget) {
      this.failed = true
      this.error = "Congestion-aware final routing exhausted its rerip budget"
    }
  }
}
