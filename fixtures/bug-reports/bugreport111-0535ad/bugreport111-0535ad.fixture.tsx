// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport111-0535ad.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
