
// @ts-nocheck
import type { ReactElement } from "react"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import bugReportJson from "./bugreport75-10612a.json"

export default (): ReactElement => {
  return <AutoroutingPipelineDebugger srj={bugReportJson.simple_route_json} />
}
