import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import srj from "./bugreport109-board-687.srj.json"

export default () => (
  <AutoroutingPipelineDebugger srj={srj as SimpleRouteJson} />
)
