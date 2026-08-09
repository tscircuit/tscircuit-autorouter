// @ts-nocheck
import { AutoroutingPipelineSolver } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport88-e921c1.json"

export default () => (
  <AutoroutingPipelineDebugger
    srj={bugReportJson.simple_route_json}
    createSolver={(srj) =>
      new AutoroutingPipelineSolver(srj, {
        effort: 10,
      })
    }
  />
)
