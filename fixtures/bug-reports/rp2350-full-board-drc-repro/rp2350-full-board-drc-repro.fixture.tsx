import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import simpleRouteJson from "./rp2350-full-board-ground-phase.srj.json" with {
  type: "json",
}

export default () => (
  <AutoroutingPipelineDebugger
    srj={structuredClone(simpleRouteJson) as SimpleRouteJson}
  />
)
