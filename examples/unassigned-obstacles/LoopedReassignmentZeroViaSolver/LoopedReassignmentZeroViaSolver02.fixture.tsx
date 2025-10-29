import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { LoopedReassignmentZeroViaSolver } from "lib/solvers/LoopedReassignmentZeroViaSolver/LoopedReassignmentZeroViaSolver"
import simpleRouteJson from "./LoopedReassignmentZeroViaSolver02.json"
import { SimpleRouteJson } from "lib/types"

function makeViasAssignable(srj: SimpleRouteJson) {
  return {
    ...srj,
    obstacles: srj.obstacles.map((obstacle) => ({
      ...obstacle,
      netIsAssignable:
        obstacle.connectedTo.length === 0 && obstacle.layers.length === 2,
    })),
  }
}

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new LoopedReassignmentZeroViaSolver(
          makeViasAssignable(simpleRouteJson as SimpleRouteJson),
          {},
        )
      }
      showDeepestVisualizationInitial={true}
    />
  )
}
