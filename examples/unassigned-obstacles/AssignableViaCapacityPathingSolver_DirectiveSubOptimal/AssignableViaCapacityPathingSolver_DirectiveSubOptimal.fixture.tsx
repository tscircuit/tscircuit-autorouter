import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
// @ts-ignore
import constructorInput from "./AssignableViaCapacityPathingSolver_DirectiveSubOptimal01.json"
import { AssignableViaCapacityPathingSolver_DirectiveSubOptimal } from "lib/solvers/AssignableViaAutoroutingPipeline/AssignableViaCapacityPathing/AssignableViaCapacityPathingSolver_DirectiveSubOptimal"

export default () => {
  const createSolver = () => {
    return new AssignableViaCapacityPathingSolver_DirectiveSubOptimal(
      (constructorInput as any)[0],
    )
  }
  return <GenericSolverDebugger createSolver={createSolver} />
}
