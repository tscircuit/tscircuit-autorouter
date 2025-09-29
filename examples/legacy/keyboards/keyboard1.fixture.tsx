import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import gkSample95 from "examples/legacy/assets/growing-grid-keyboard-sample-sample95-unrouted_simple_route.json"
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={gkSample95 as unknown as SimpleRouteJson}
      animationSpeed={10}
    />
  )
}
