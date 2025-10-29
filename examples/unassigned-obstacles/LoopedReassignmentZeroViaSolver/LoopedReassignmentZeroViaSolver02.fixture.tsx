import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { LoopedReassignmentZeroViaSolver } from "lib/solvers/LoopedReassignmentZeroViaSolver/LoopedReassignmentZeroViaSolver"
import simpleRouteJson from "./LoopedReassignmentZeroViaSolver01.json"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new LoopedReassignmentZeroViaSolver(simpleRouteJson, {})
      }
      showDeepestVisualizationInitial={true}
    />
  )
}
