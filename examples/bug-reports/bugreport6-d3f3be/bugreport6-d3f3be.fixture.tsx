// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport6-d3f3be.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
