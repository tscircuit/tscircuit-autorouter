import type { TinyHyperGraphProblem, TinyHyperGraphSolverOptions, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { PreparedPortPointRoutingSolver } from "tiny-hypergraph/lib/prepared/PreparedPortPointRoutingSolver"

/** Apply speculative seeds once; later rerips must be free to replace them. */
export class WarmStartedPreparedPortPointRoutingSolver extends PreparedPortPointRoutingSolver {
  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    // The base constructor has already applied these assignments to state.
    // This subclass is only used for generated seeds, never preloaded copper.
    this.problem.initialAssignments = undefined
  }
}
