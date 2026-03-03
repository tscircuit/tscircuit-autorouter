// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { GreedySequentialPipelineSolver } from "lib/autorouter-pipelines/GreedySequentialPipeline/GreedySequentialPipelineSolver"
import bugReportJson from "../bug-reports/bugreport18-1b2d06/bugreport18-1b2d06.json"

export default () => (
  <AutoroutingPipelineDebugger
    createSolver={(srj) => new GreedySequentialPipelineSolver(srj)}
    srj={bugReportJson.simple_route_json}
  />
)
