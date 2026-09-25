import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "./bugreport96-gameboy-four-layer.srj.json" with {
  type: "json",
}

export default () => (
  <AutoroutingPipelineDebugger srj={simpleRouteJson as SimpleRouteJson} />
)
