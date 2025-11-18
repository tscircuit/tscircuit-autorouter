// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./internal-connected-pins.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson} />
}
