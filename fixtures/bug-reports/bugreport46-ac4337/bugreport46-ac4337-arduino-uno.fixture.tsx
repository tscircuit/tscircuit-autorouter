// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport46-ac4337-arduino-uno.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
