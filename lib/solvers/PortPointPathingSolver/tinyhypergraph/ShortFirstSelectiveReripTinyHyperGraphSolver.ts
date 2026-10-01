import type {
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"
import { getShortFirstRouteOrder } from "./getShortFirstRouteOrder"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "./SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"

/** Changes the initial queue only; retries and committed copper use the existing engine. */
export class ShortFirstSelectiveReripTinyHyperGraphSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    const pendingRouteIds = new Set(this.state.unroutedRoutes)
    this.state.unroutedRoutes = getShortFirstRouteOrder(
      Array.from({ length: problem.routeCount }, (_, routeId) => {
        const start = problem.routeStartPort[routeId]!
        const end = problem.routeEndPort[routeId]!
        return {
          routeId,
          netId: problem.routeNet[routeId]!,
          start: { x: topology.portX[start]!, y: topology.portY[start]! },
          end: { x: topology.portX[end]!, y: topology.portY[end]! },
        }
      }).filter((route) => pendingRouteIds.has(route.routeId)),
    )
  }
}
