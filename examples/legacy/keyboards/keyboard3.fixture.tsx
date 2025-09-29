import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import keyboard3 from "examples/legacy/assets/keyboard3.json"
import type { SimpleRouteJson } from "lib/types"

export default () => {
  return (
    <AutoroutingPipelineDebugger
      srj={keyboard3 as unknown as SimpleRouteJson}
      animationSpeed={10}
    />
  )
}
