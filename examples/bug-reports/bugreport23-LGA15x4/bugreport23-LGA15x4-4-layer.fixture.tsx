// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport23-LGA15x4-4-layer.srj.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson} />
}
