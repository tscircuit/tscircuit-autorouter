import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import input from "./bugreport106-pipeline9-qspi-via-pad-overlap.srj.json"

// Keep the single-argument Pipeline9 invocation from issue #2654.
export default function Bugreport106(): React.JSX.Element {
  return (
    <AutoroutingPipelineDebugger
      srj={input as SimpleRouteJson}
      createSolver={(srj): AutoroutingPipelineSolver9_PreloadedTraceGraph =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(srj))
      }
    />
  )
}
