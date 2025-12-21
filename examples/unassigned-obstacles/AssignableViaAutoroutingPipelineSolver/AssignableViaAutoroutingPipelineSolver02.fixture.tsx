import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { AssignableAutoroutingPipeline1Solver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline1/AssignableAutoroutingPipeline1Solver"

import simpleRouteJson from "../LoopedReassignmentZeroViaSolver/LoopedReassignmentZeroViaSolver02.json"
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

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj, opts) =>
      new AssignableAutoroutingPipeline1Solver(srj, opts)
    }
    srj={makeViasAssignable(simpleRouteJson as SimpleRouteJson)}
  />
)
