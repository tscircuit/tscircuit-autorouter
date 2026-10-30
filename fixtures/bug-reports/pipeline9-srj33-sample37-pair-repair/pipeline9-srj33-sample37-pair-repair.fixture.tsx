import type { ReactElement } from "react"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import srj from "./input.srj.json"

export default function Pipeline9Srj33Sample37PairRepairFixture(): ReactElement {
  return (
    <AutoroutingPipelineDebugger
      srj={srj as SimpleRouteJson}
      createSolver={(
        inputSrj: SimpleRouteJson,
      ): AutoroutingPipelineSolver9_PreloadedTraceGraph =>
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
          cacheProvider: null,
          effort: 1,
        })
      }
    />
  )
}
