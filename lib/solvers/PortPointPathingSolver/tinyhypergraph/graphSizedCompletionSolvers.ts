import type {
  TinyHyperGraphSolver,
  TinyHyperGraphSolverOptions,
} from "tiny-hypergraph/lib/core"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "tiny-hypergraph/lib/prepared/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"

// A fixed completion cap can expire before one traversal of a large graph.
// Preserve its existing floor and account for the region and route counts.
export class NativeRoutingSolverWithGraphSizedCompletion extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    const solver = super.createGreedyFinalRouteSolver(options, attempt)
    if (attempt >= 0) {
      solver.MAX_ITERATIONS = Math.max(
        solver.MAX_ITERATIONS,
        this.topology.regionCount + this.problem.routeCount,
      )
    }
    return solver
  }
}

export class PreparedRoutingSolverWithGraphSizedCompletion extends PreparedPortPointRoutingSolver {
  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    const solver = super.createGreedyFinalRouteSolver(options, attempt)
    if (attempt >= 0) {
      solver.MAX_ITERATIONS = Math.max(
        solver.MAX_ITERATIONS,
        this.topology.regionCount + this.problem.routeCount,
      )
    }
    return solver
  }
}
