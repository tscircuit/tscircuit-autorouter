// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./pour-via-escape02.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
