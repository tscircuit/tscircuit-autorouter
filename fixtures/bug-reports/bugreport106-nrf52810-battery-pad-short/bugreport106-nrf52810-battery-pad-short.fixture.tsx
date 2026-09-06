import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import type { ReactElement } from "react"
import input from "./bugreport106-nrf52810-battery-pad-short.srj.json"

export default function NrfLivePipeline9(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={input as SimpleRouteJson}
      createSolver={(srj, options) =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(
          structuredClone(srj),
          {
            ...options,
            cacheProvider: null,
          },
        )
      }
    />
  )
}
