import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { simpleRouteJson } from "../LoopedReassignmentZeroViaSolver/LoopedReassignmentZeroViaSolver01.fixture"
import { AssignableViaAutoroutingPipelineSolver } from "lib/solvers/AssignableViaAutoroutingPipeline/AssignableViaAutoroutingPipelineSolver"

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj, opts) =>
      new AssignableViaAutoroutingPipelineSolver(srj, opts)
    }
    srj={simpleRouteJson as any}
  />
)
