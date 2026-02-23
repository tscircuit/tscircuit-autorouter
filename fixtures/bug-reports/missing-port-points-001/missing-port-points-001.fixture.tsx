// @ts-nocheck
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./missing-port-points-001.json"
export default () => {
  return <AutoroutingPipelineDebugger srj={bugReportJson} />
}
/**
 * This fixture reproduces a pipeline bug that makes certain obstacles
 * unreachable by the routing algorithm. The issue is caused by missing
 * port points.
 */
