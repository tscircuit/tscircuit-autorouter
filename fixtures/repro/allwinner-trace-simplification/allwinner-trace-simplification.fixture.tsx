import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { createAllwinnerTraceSimplificationSolver } from "./create-allwinner-trace-simplification-solver"

export default () => (
  <GenericSolverDebugger
    createSolver={createAllwinnerTraceSimplificationSolver}
  />
)
