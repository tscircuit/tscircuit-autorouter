import { SingleSimplifiedPathSolver5 } from "./SingleSimplifiedPathSolver5_Deg45"
import { TraceSimplificationSolverAdapter } from "../../bindings/trace-simplification/TraceSimplificationSolverAdapter"
export class VertexShortcutPathSolver extends SingleSimplifiedPathSolver5 {
  static override solverKind = "vertex"
  static override stateFields = [...SingleSimplifiedPathSolver5.stateFields, "vertexIndex"]
  declare private vertexIndex: number
  constructor(params: ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0]) { super(params) }
  override getSolverName(): string { return "VertexShortcutPathSolver" }
}
TraceSimplificationSolverAdapter.register("vertex", VertexShortcutPathSolver)
