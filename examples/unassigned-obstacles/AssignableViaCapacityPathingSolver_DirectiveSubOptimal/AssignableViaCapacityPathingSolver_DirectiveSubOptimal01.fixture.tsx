import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
// @ts-ignore
import constructorInput from "./AssignableViaCapacityPathingSolver_DirectiveSubOptimal01.json"
import { AssignableViaCapacityPathingSolver_DirectiveSubOptimal } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableViaCapacityPathing/AssignableViaCapacityPathingSolver_DirectiveSubOptimal"

const createSolver = () => {
  return new AssignableViaCapacityPathingSolver_DirectiveSubOptimal({
    ...(constructorInput as any)[0],
    hyperParameters: {
      FORCE_VIA_TRAVEL_CHANCE: 1,
      FAR_VIA_MIN_DISTANCE: 10,
      SHUFFLE_SEED: 4,
      MAX_CLOSEST_VIA_SKIP: 0,
    },
  })
}

export default () => {
  return <GenericSolverDebugger createSolver={createSolver} />
}
