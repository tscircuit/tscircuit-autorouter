import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import captured from "./loralink-v1/loralink-v1.solver-input.json"

export default function LoRaLinkV1Fixture(): React.JSX.Element {
  return (
    <AutoroutingPipelineDebugger
      srj={captured.input as SimpleRouteJson}
      createSolver={(input) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, captured.options)
      }
    />
  )
}
