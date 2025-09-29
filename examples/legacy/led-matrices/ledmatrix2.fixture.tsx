import { InteractiveGraphics } from "graphics-debug/react"
import contributionBoardRoutes from "examples/legacy/assets/contribution-board_routes_small.json"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"

export default () => (
  <AutoroutingPipelineDebugger
    srj={contributionBoardRoutes as unknown as SimpleRouteJson}
  />
)
