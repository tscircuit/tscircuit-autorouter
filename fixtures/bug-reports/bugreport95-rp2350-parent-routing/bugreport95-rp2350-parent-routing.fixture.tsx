import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import bugReportJson from "./bugreport95-rp2350-parent-routing.json"

const srj = bugReportJson.simple_route_json as SimpleRouteJson

export default () => {
  return <AutoroutingPipelineDebugger srj={srj} />
}
