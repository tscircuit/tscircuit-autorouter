import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { AssignableViaAutoroutingPipelineSolver } from "lib/solvers/AssignableViaAutoroutingPipeline/AssignableViaAutoroutingPipelineSolver"

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
      new AssignableViaAutoroutingPipelineSolver(srj, opts)
    }
    srj={makeViasAssignable(simpleRouteJson as SimpleRouteJson)}
  />
)
