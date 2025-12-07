// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport20-obstacle-clipping.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson} />
}
