import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import input from "./input.srj.json"

export default function BeaglePlayDdr4(): React.JSX.Element {
  return (
    <div>
      <h2>BeaglePlay Rev A2 DDR4</h2>
      <p>
        AM6254 and K4AAG165WA-BCWE · 52 DDR signal nets · 8 copper layers
      </p>
      <AutoroutingPipelineDebugger srj={input as SimpleRouteJson} />
    </div>
  )
}
