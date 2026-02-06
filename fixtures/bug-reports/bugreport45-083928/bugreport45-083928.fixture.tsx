// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport45-083928.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
