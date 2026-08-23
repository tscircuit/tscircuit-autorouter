import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "./bugreport96-full-gameboy-no-breakout.srj.json" with {
  type: "json",
}

export default () => (
  <AutoroutingPipelineDebugger srj={simpleRouteJson as SimpleRouteJson} />
)
