import type { NegotiatedClearanceInput } from "@tscircuit/repair04"
import { Pipeline9BoundedRegionalRepairSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { Pipeline9DenseNegotiateTraceClearanceSolver } from "./repair04/Pipeline9DenseNegotiateTraceClearanceSolver"
import { Pipeline9ClearanceProjectionSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { Pipeline9IndexedClearanceProjectionSolver } from "./Pipeline9IndexedClearanceProjectionSolver"

/** Same regional policy and publication guards, with bounded A* storage. */
export class Pipeline9DenseBoundedRegionalRepairSolver extends Pipeline9BoundedRegionalRepairSolver {
  protected override createNegotiationSolver(
    input: NegotiatedClearanceInput,
  ): Pipeline9DenseNegotiateTraceClearanceSolver {
    return new Pipeline9DenseNegotiateTraceClearanceSolver(input)
  }

  protected override createProjectionSolver(
    params: ConstructorParameters<typeof Pipeline9ClearanceProjectionSolver>[0],
  ): Pipeline9IndexedClearanceProjectionSolver {
    return new Pipeline9IndexedClearanceProjectionSolver(params)
  }
}
