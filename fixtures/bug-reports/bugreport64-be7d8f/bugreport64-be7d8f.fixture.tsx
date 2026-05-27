// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport64-be7d8f.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
