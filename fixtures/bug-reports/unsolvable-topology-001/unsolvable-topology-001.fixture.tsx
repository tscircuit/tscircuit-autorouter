// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./unsolvable-topology-001.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson} />
}
