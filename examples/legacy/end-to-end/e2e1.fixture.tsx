import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"
import keyboardRoutes from "../../legacy/assets/growing-grid-keyboard-sample-sample95-unrouted_simple_route.json"

export default () => {
  return <AutoroutingPipelineDebugger srj={keyboardRoutes as SimpleRouteJson} />
}
