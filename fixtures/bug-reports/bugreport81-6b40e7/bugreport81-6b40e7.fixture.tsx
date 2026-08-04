// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport81-6b40e7.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
