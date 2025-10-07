// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport9-618e09.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
