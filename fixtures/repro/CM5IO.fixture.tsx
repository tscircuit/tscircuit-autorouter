import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import cm5ioRoute from "../../tests/repro/CM5IO.route.json" with {
  type: "json",
}

export default () => {
  return <AutoroutingPipelineDebugger srj={cm5ioRoute as SimpleRouteJson} />
}
