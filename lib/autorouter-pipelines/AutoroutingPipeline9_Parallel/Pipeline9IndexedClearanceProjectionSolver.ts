import type { RelaxTraceClearanceInput } from "@tscircuit/repair04"
import { Pipeline9ClearanceProjectionSolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9ClearanceProjectionSolver"
import { Pipeline9IndexedRelaxTraceClearanceSolver } from "./repair04/Pipeline9IndexedRelaxTraceClearanceSolver"
import { Pipeline9WasmRelaxTraceClearanceSolver } from "./repair04/Pipeline9WasmRelaxTraceClearanceSolver"

/** Retains every publication guard while indexing the projection's constraints. */
export class Pipeline9IndexedClearanceProjectionSolver extends Pipeline9ClearanceProjectionSolver {
  protected override createRelaxationSolver(
    input: RelaxTraceClearanceInput,
  ): Pipeline9IndexedRelaxTraceClearanceSolver {
    return new Pipeline9WasmRelaxTraceClearanceSolver(input)
  }
}
