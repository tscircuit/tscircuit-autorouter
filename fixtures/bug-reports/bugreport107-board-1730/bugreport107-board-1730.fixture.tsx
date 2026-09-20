import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import bugReport from "./bugreport107-board-1730.json"

export default () => (
  <AutoroutingPipelineDebugger
    srj={bugReport.simple_route_json as SimpleRouteJson}
  />
)
