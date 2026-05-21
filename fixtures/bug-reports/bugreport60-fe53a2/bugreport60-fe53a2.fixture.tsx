// @ts-nocheck
import { AutoroutingPipelineSolver8 } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport60-fe53a2.json"
export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={bugReportJson.simple_route_json}
      createSolver={(srj, opts) => new AutoroutingPipelineSolver8(srj, opts)}
    />
  )
}
