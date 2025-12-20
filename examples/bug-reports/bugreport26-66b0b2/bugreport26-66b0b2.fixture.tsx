// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport26-66b0b2.json"
import { AssignableViaAutoroutingPipelineSolver } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline/AssignableAutoroutingPipelineSolver"
export default () => {
  return (
    <AutoroutingPipelineDebugger
      createSolver={() =>
        new AssignableViaAutoroutingPipelineSolver(
          bugReportJson.simple_route_json,
        )
      }
      srj={bugReportJson.simple_route_json}
    />
  )
}
