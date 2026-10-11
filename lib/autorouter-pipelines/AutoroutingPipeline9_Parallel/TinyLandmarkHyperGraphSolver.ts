import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import type { TinyHyperGraphProblem, TinyHyperGraphSolverOptions, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyLandmarkHeuristic } from "./TinyLandmarkHeuristic"

/** The landmark policy always pays the geometric distance used by its bound. */
export class TinyLandmarkHyperGraphSolver extends DistanceAwareTinyHyperGraphSolver {
  readonly landmarkHeuristic: TinyLandmarkHeuristic

  constructor(topology: TinyHyperGraphTopology, problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions) {
    super(topology, problem, options)
    this.landmarkHeuristic = new TinyLandmarkHeuristic(this)
  }

  override computeH(portId: number): number {
    const routeId = this.state.currentRouteId
    if (routeId === undefined) throw new Error("Landmark route heuristic requires an active route")
    return Math.max(super.computeH(portId),
      this.landmarkHeuristic.lowerBound(portId, this.getRouteEndPortId(routeId)))
  }
}
