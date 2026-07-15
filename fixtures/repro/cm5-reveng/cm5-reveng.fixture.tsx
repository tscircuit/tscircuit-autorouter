import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import srj from "./cm5-reveng.srj.json" with { type: "json" }

export default () => {
  return <AutoroutingPipelineDebugger srj={srj as SimpleRouteJson} />
}
