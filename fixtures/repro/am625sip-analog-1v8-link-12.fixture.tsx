import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import realBoardPhase from "./am625sip-analog-1v8-link-12.srj.json"

export default () => (
  <AutoroutingPipelineDebugger srj={realBoardPhase as SimpleRouteJson} />
)
