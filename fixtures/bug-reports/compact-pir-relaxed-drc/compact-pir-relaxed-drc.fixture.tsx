import type { ReactElement } from "react"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import input from "./input.srj.json"

export default function CompactPirRelaxedDrcFixture(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={input as SimpleRouteJson}
      createSolver={(
        inputSrj: SimpleRouteJson,
      ): AutoroutingPipelineSolver9_PreloadedTraceGraph =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
          effort: 1,
          cacheProvider: null,
        })
      }
    />
  )
}
