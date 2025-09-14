// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport4-aa1d41.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
