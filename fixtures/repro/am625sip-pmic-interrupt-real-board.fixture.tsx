import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import realBoardPhase from "./am625sip-pmic-interrupt-real-board.srj.json"

export default () => (
  <AutoroutingPipelineDebugger srj={realBoardPhase as SimpleRouteJson} />
)
